"""
Build a LangGraph dynamically from a visual spec (list of node dicts + edge dicts).

Node dicts:  {"id": "n1", "type": "planner"}
Edge dicts:  {"source": "n1", "target": "n2"}

Rules
-----
* Nodes with no incoming edge  → wired after START
* Nodes with no outgoing edge  → wired before END
* All other nodes              → wired via the provided edges
* Conditional routing after `critic_review` is added automatically when both
  "revise" and "finalize" are reachable from it.
"""
from __future__ import annotations

from typing import Literal

from langgraph.graph import END, START, StateGraph

from instrumentation.components import REGISTRY, ResearchState


def _route_critic(state: ResearchState) -> Literal["revise", "finalize"]:
    if state.get("critic_verdict") == "revise" and state.get("revision_count", 0) < 1:
        return "revise"
    return "finalize"


def build_dynamic_graph(
    nodes: list[dict],
    edges: list[dict],
):
    """
    Compile a LangGraph from a visual spec.  Returns a compiled graph ready
    for ``graph.invoke(initial_state, config={"callbacks": [probe]})``.
    """
    if not nodes:
        raise ValueError("Graph must contain at least one node.")

    builder = StateGraph(ResearchState)

    id_to_type: dict[str, str] = {}
    for node in nodes:
        node_id = node["id"]
        node_type = node["type"]
        if node_type not in REGISTRY:
            raise ValueError(
                f"Unknown component type: {node_type!r}. "
                f"Valid types: {list(REGISTRY)}"
            )
        builder.add_node(node_id, REGISTRY[node_type]["fn"])
        id_to_type[node_id] = node_type

    all_ids = {n["id"] for n in nodes}
    targets = {e["target"] for e in edges}
    sources = {e["source"] for e in edges}

    # Nodes reachable from critic_review — used for conditional routing
    critic_nodes = {n["id"] for n in nodes if id_to_type[n["id"]] == "critic_review"}
    critic_targets = {e["target"] for e in edges if e["source"] in critic_nodes}

    has_conditional = bool(critic_nodes) and bool(critic_targets)

    # Wire START → entry nodes
    for start_id in all_ids - targets:
        builder.add_edge(START, start_id)

    # Wire edges (skip edges out of critic_review if using conditional routing)
    for edge in edges:
        if has_conditional and edge["source"] in critic_nodes:
            continue  # handled below
        builder.add_edge(edge["source"], edge["target"])

    # Conditional routing from critic_review
    if has_conditional:
        for critic_id in critic_nodes:
            # Build a mapping of route key → node_id
            route_map: dict[str, str] = {}
            for e in edges:
                if e["source"] == critic_id:
                    t_type = id_to_type.get(e["target"], "")
                    if t_type == "revise":
                        route_map["revise"] = e["target"]
                    elif t_type == "finalize":
                        route_map["finalize"] = e["target"]

            if "revise" in route_map and "finalize" in route_map:
                builder.add_conditional_edges(critic_id, _route_critic, route_map)
            else:
                # Partial wiring — just use sequential edges
                for e in edges:
                    if e["source"] == critic_id:
                        builder.add_edge(e["source"], e["target"])

    # Wire terminal nodes → END
    for end_id in all_ids - sources:
        builder.add_edge(end_id, END)

    return builder.compile()
