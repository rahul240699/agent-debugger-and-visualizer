"""
Bigger demo: 7-node research pipeline wired with AgentProbe.

Topology (watch the DAG light up live):

    planner
       ↓
  fact_checker
       ↓
  domain_expert
       ↓
   aggregator
       ↓
  critic_review
    ↙       ↘
 revise   finalize          ← conditional: critic decides route
    ↓
 finalize

Node implementations live in instrumentation/components.py so they can be
reused in the visual Pipeline Builder.

Run with:
    PYTHONPATH=. python -m instrumentation.example_agent
"""
from __future__ import annotations

import os
import uuid

from dotenv import load_dotenv

load_dotenv()

from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, StateGraph

from instrumentation import AgentProbe
from instrumentation.components import (
    REGISTRY,
    ResearchState,
    _planner as planner,
    _fact_checker as fact_checker,
    _domain_expert as domain_expert,
    _aggregator as aggregator,
    _critic_review as critic_review,
    _revise as revise,
    _finalize as finalize,
)
from instrumentation.dynamic_graph import _route_critic


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


def build_graph():
    builder = StateGraph(ResearchState)

    builder.add_node("planner",       planner)
    builder.add_node("fact_checker",  fact_checker)
    builder.add_node("domain_expert", domain_expert)
    builder.add_node("aggregator",    aggregator)
    builder.add_node("critic_review", critic_review)
    builder.add_node("revise",        revise)
    builder.add_node("finalize",      finalize)

    builder.add_edge(START,           "planner")
    builder.add_edge("planner",       "fact_checker")
    builder.add_edge("fact_checker",  "domain_expert")
    builder.add_edge("domain_expert", "aggregator")
    builder.add_edge("aggregator",    "critic_review")
    builder.add_conditional_edges("critic_review", _route_critic)
    builder.add_edge("revise",        "finalize")
    builder.add_edge("finalize",      END)

    return builder.compile()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

TOPICS = [
    "The impact of large language models on scientific research",
    "Advances in solid-state battery technology",
    "CRISPR gene editing applications in medicine",
]


def run(topic: str | None = None, run_id: str | None = None) -> None:
    import random
    chosen = topic or random.choice(TOPICS)
    run_id = run_id or f"run-{uuid.uuid4().hex[:8]}"
    print(f"Starting run  : {run_id}")
    print(f"Topic         : {chosen}")
    print(f"Dashboard URL : http://localhost:3000/dashboard?run={run_id}")
    print()

    probe = AgentProbe(run_id=run_id)
    graph = build_graph()

    result = graph.invoke(
        {
            "messages": [HumanMessage(content=chosen)],
            "topic": chosen,
            "fact_check_notes": "",
            "domain_notes": "",
            "aggregated_draft": "",
            "critic_verdict": "",
            "revision_notes": "",
            "final_answer": "",
            "revision_count": 0,
        },
        config={"callbacks": [probe]},
    )
    probe.flush()

    print("\n" + "=" * 60)
    print("FINAL ANSWER")
    print("=" * 60)
    print(result.get("final_answer") or result["messages"][-1].content)


if __name__ == "__main__":
    run()

