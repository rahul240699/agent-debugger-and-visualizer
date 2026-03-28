"""
Builder endpoints.

GET  /api/components          — return the full component registry (for the UI palette)
POST /api/build               — accept a graph spec, start it in a background thread,
                                return {run_id}
"""
from __future__ import annotations

import json
import logging
import threading
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from instrumentation import AgentProbe
from instrumentation.components import REGISTRY, ResearchState
from instrumentation.dynamic_graph import build_dynamic_graph
from backend.run_manager import RunHandle, register, remove

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------


class ComponentInfo(BaseModel):
    key: str
    label: str
    description: str
    color: str
    reads: list[str]
    writes: list[str]
    tools: list[str]


class NodeSpec(BaseModel):
    id: str
    type: str


class EdgeSpec(BaseModel):
    source: str
    target: str


class BuildRequest(BaseModel):
    topic: str
    nodes: list[NodeSpec]
    edges: list[EdgeSpec]
    run_id: str | None = None
    interrupt_before: list[str] = []


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/components", response_model=list[ComponentInfo])
async def get_components() -> list[ComponentInfo]:
    """Return all registered component types for the builder palette."""
    return [
        ComponentInfo(
            key=key,
            label=meta["label"],
            description=meta["description"],
            color=meta["color"],
            reads=meta["reads"],
            writes=meta["writes"],
            tools=meta["tools"],
        )
        for key, meta in REGISTRY.items()
    ]


@router.post("/build")
async def build_and_run(req: BuildRequest, request: Request) -> dict:
    """
    Build a LangGraph from the visual spec and run it asynchronously.
    Returns {run_id} immediately; the client should open /dashboard?run={run_id}.
    """
    topic = req.topic.strip()
    if not topic:
        raise HTTPException(status_code=422, detail="'topic' is required.")
    if not req.nodes:
        raise HTTPException(status_code=422, detail="Graph must have at least one node.")

    nodes_list = [{"id": n.id, "type": n.type} for n in req.nodes]
    edges_list = [{"source": e.source, "target": e.target} for e in req.edges]

    try:
        graph = build_dynamic_graph(
            nodes_list, edges_list, interrupt_before=req.interrupt_before
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    from langchain_core.messages import HumanMessage

    run_id = req.run_id or f"run-{uuid.uuid4().hex[:8]}"

    # Persist topology so the WS HYDRATE message can include it for the dashboard
    redis_client = request.app.state.redis
    await redis_client.set(
        f"topology:{run_id}",
        json.dumps({"nodes": nodes_list, "edges": edges_list}),
        ex=86400,  # TTL 24 h
    )

    initial_state: ResearchState = {
        "messages": [HumanMessage(content=topic)],
        "topic": topic,
        "fact_check_notes": "",
        "domain_notes": "",
        "aggregated_draft": "",
        "critic_verdict": "",
        "revision_notes": "",
        "final_answer": "",
        "revision_count": 0,
    }

    def _run() -> None:
        handle = RunHandle(
            run_id=run_id,
            graph=graph,
            config={"configurable": {"thread_id": run_id}},
        )
        register(run_id, handle)
        probe = AgentProbe(run_id=run_id)
        invoke_cfg = {**handle.config, "callbacks": [probe]}
        try:
            # --- first invocation (may pause at first interrupt_before node) ---
            graph.invoke(initial_state, config=invoke_cfg)

            # --- interrupt loop ---
            snapshot = graph.get_state(handle.config)
            while snapshot.next:
                interrupted_nodes = list(snapshot.next)
                current_state = dict(snapshot.values)

                probe.emit_interrupt(interrupted_nodes, current_state)
                handle.status = "INTERRUPTED"
                handle.interrupted_nodes = interrupted_nodes
                handle.interrupted_state = current_state

                # Block until the resume endpoint signals us (10-min safety timeout)
                signaled = handle.resume_event.wait(timeout=600)
                handle.resume_event.clear()

                if handle.cancel or not signaled:
                    logger.warning("Run %s cancelled or timed out at interrupt", run_id)
                    break

                # Apply optional state patch (set by resume endpoint)
                if handle.state_patch:
                    graph.update_state(handle.config, handle.state_patch)
                    handle.state_patch = None

                handle.status = "RUNNING"
                graph.invoke(None, config=invoke_cfg)
                snapshot = graph.get_state(handle.config)

            handle.status = "COMPLETE"
        except Exception as exc:
            handle.status = "ERROR"
            logger.error("Run %s failed: %s", run_id, exc)
        finally:
            probe.flush()
            remove(run_id)

    threading.Thread(target=_run, daemon=True).start()
    return {"run_id": run_id}
