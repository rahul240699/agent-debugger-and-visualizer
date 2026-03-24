"""
Bigger demo: 7-node research pipeline wired with AgentProbe.

Topology (watch the DAG light up live):

    planner
       ↓
  ┌────┴────┐
fact_checker  domain_expert        ← run sequentially, both branch from planner
  └────┬────┘
   aggregator
       ↓
  critic_review
    ↙       ↘
 revise   finalize                 ← conditional: critic decides route
    ↓
 finalize

Run with:
    PYTHONPATH=. python -m instrumentation.example_agent
"""
from __future__ import annotations

import os
import uuid
from typing import Annotated, Literal, TypedDict

from dotenv import load_dotenv

load_dotenv()

from langchain_core.messages import HumanMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from instrumentation import AgentProbe

# ---------------------------------------------------------------------------
# LLM
# ---------------------------------------------------------------------------

llm = ChatOpenAI(model="gpt-4o-mini", api_key=os.environ["OPENAI_API_KEY"])

# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
def web_search(query: str) -> str:
    """Search the web for up-to-date information on a topic."""
    return (
        f"[WEB] Results for '{query}': "
        "Multiple authoritative sources confirm recent advances. "
        "Key findings include improved efficiency metrics and new applications."
    )


@tool
def calculator(expression: str) -> str:
    """Evaluate a simple arithmetic expression."""
    allowed = set("0123456789+-*/()., ")
    if not all(c in allowed for c in expression):
        return "Error: invalid characters"
    try:
        return str(eval(expression, {"__builtins__": {}}))  # noqa: S307
    except Exception as exc:
        return f"Error: {exc}"


@tool
def fetch_stats(topic: str) -> str:
    """Retrieve key statistics and numbers for a topic."""
    return (
        f"[STATS] For '{topic}': "
        "Market size $42B (2024), 34% YoY growth, "
        "1,200+ active research groups globally, "
        "Top regions: US (38%), EU (24%), Asia (31%)."
    )


@tool
def cite_sources(claim: str) -> str:
    """Find academic or reputable citations supporting a claim."""
    return (
        f"[CITATIONS] Supporting '{claim[:60]}...': "
        "Nature (2024), Science (2023), IEEE Trans. (2024), "
        "arXiv:2401.12345, arXiv:2312.98765."
    )


_TOOLS = {t.name: t for t in [web_search, calculator, fetch_stats, cite_sources]}
llm_with_tools = llm.bind_tools(list(_TOOLS.values()))


def _run_tools(response) -> tuple[list, str]:
    """Execute any tool calls in an LLM response, return (new_messages, notes)."""
    new_messages: list = [response]
    notes = ""
    if hasattr(response, "tool_calls") and response.tool_calls:
        for tc in response.tool_calls:
            fn = _TOOLS.get(tc["name"])
            result = fn.invoke(tc["args"]) if fn else f"Unknown tool: {tc['name']}"
            notes += f"\n{result}"
            new_messages.append(ToolMessage(content=str(result), tool_call_id=tc["id"]))
    return new_messages, notes


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


class ResearchState(TypedDict):
    messages: Annotated[list, add_messages]
    topic: str
    fact_check_notes: str
    domain_notes: str
    aggregated_draft: str
    critic_verdict: str   # "approve" | "revise"
    revision_notes: str
    final_answer: str
    revision_count: int


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------


def planner(state: ResearchState) -> ResearchState:
    """Break the topic into parallel research tracks."""
    response = llm.invoke([
        HumanMessage(content=(
            f"Topic: {state['topic']}\n\n"
            "You are a research planner. Output a brief plan listing:\n"
            "1. Key facts to verify\n"
            "2. Domain-specific angles to explore\n"
            "Keep it concise (3-4 bullets each)."
        ))
    ])
    return {"messages": [response]}


def fact_checker(state: ResearchState) -> ResearchState:
    """Verify core facts using web search and citations."""
    response = llm_with_tools.invoke([
        *state["messages"],
        HumanMessage(content=(
            f"Fact-check the research plan above for topic: {state['topic']}.\n"
            "Use web_search and cite_sources to verify the most important claims."
        ))
    ])
    msgs, notes = _run_tools(response)
    return {"messages": msgs, "fact_check_notes": notes}


def domain_expert(state: ResearchState) -> ResearchState:
    """Deep-dive domain analysis with statistics."""
    response = llm_with_tools.invoke([
        *state["messages"],
        HumanMessage(content=(
            f"You are a domain expert on: {state['topic']}.\n"
            "Use fetch_stats and web_search to provide expert-level data, "
            "numbers, and context."
        ))
    ])
    msgs, notes = _run_tools(response)
    return {"messages": msgs, "domain_notes": notes}


def aggregator(state: ResearchState) -> ResearchState:
    """Merge fact-check + domain notes into a coherent draft."""
    combined = (
        f"Fact-check findings:\n{state['fact_check_notes']}\n\n"
        f"Domain expert findings:\n{state['domain_notes']}"
    )
    response = llm.invoke([
        *state["messages"],
        HumanMessage(content=(
            f"Synthesise these research findings into a structured draft answer "
            f"about '{state['topic']}':\n\n{combined}\n\n"
            "Output: 3-4 well-structured paragraphs."
        ))
    ])
    return {"messages": [response], "aggregated_draft": response.content}


def critic_review(state: ResearchState) -> ResearchState:
    """Quality-gate: decide whether the draft needs revision."""
    response = llm.invoke([
        HumanMessage(content=(
            f"Review this draft about '{state['topic']}':\n\n"
            f"{state['aggregated_draft']}\n\n"
            "Assess: Is this accurate, complete, and well-written?\n"
            "Reply with exactly one word on the first line: APPROVE or REVISE\n"
            "Then explain briefly why (2-3 sentences)."
        ))
    ])
    verdict_text = response.content.strip().upper()
    verdict = "approve" if verdict_text.startswith("APPROVE") else "revise"
    return {
        "messages": [response],
        "critic_verdict": verdict,
    }


def revise(state: ResearchState) -> ResearchState:
    """Apply critic feedback and improve the draft."""
    response = llm.invoke([
        *state["messages"],
        HumanMessage(content=(
            f"The critic said to revise the draft about '{state['topic']}'.\n"
            f"Critic notes: {state['messages'][-1].content}\n\n"
            f"Original draft:\n{state['aggregated_draft']}\n\n"
            "Produce an improved version addressing all concerns."
        ))
    ])
    return {
        "messages": [response],
        "aggregated_draft": response.content,
        "revision_notes": response.content,
        "revision_count": state.get("revision_count", 0) + 1,
        "critic_verdict": "approve",  # force approve after one revision
    }


def finalize(state: ResearchState) -> ResearchState:
    """Polish and format the final answer."""
    response = llm.invoke([
        HumanMessage(content=(
            f"Final polish for this research answer about '{state['topic']}':\n\n"
            f"{state['aggregated_draft']}\n\n"
            "Format it cleanly with a title, 3-4 paragraphs, and a one-sentence summary at the end."
        ))
    ])
    return {"messages": [response], "final_answer": response.content}


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------


def route_critic(state: ResearchState) -> Literal["revise", "finalize"]:
    """Send to revise if critic said so (max 1 revision), else finalize."""
    if state.get("critic_verdict") == "revise" and state.get("revision_count", 0) < 1:
        return "revise"
    return "finalize"


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------


def build_graph():
    builder = StateGraph(ResearchState)

    builder.add_node("planner", planner)
    builder.add_node("fact_checker", fact_checker)
    builder.add_node("domain_expert", domain_expert)
    builder.add_node("aggregator", aggregator)
    builder.add_node("critic_review", critic_review)
    builder.add_node("revise", revise)
    builder.add_node("finalize", finalize)

    builder.add_edge(START, "planner")
    builder.add_edge("planner", "fact_checker")
    builder.add_edge("fact_checker", "domain_expert")
    builder.add_edge("domain_expert", "aggregator")
    builder.add_edge("aggregator", "critic_review")
    builder.add_conditional_edges("critic_review", route_critic)
    builder.add_edge("revise", "finalize")
    builder.add_edge("finalize", END)

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

