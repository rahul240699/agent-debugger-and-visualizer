"""
Builder endpoints.

GET  /api/components          — return the full component registry (for the UI palette)
POST /api/build               — accept a graph spec, start it in a background thread,
                                return {run_id}
"""
from __future__ import annotations

import threading
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from instrumentation import AgentProbe
from instrumentation.components import REGISTRY, ResearchState
from instrumentation.dynamic_graph import build_dynamic_graph

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
async def build_and_run(req: BuildRequest) -> dict:
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
        graph = build_dynamic_graph(nodes_list, edges_list)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    from langchain_core.messages import HumanMessage

    run_id = req.run_id or f"run-{uuid.uuid4().hex[:8]}"

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
        probe = AgentProbe(run_id=run_id)
        try:
            graph.invoke(initial_state, config={"callbacks": [probe]})
        finally:
            probe.flush()

    threading.Thread(target=_run, daemon=True).start()
    return {"run_id": run_id}
