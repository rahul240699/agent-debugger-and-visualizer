"""
Example: wiring AgentProbe into a LangGraph multi-agent swarm.

This demonstrates a three-node graph:
  analyst → researcher (uses a web-search tool) → synthesizer

Run with:
    PYTHONPATH=. python -m instrumentation.example_agent
"""
from __future__ import annotations

import os
import uuid
from typing import Annotated, TypedDict

from dotenv import load_dotenv

load_dotenv()

from langchain_core.messages import HumanMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from instrumentation import AgentProbe


# ---------------------------------------------------------------------------
# State definition
# ---------------------------------------------------------------------------


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    research_notes: str
    final_answer: str


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
def web_search(query: str) -> str:
    """Search the web for information. Returns a short stub for demo purposes."""
    return f"[SEARCH RESULT] Top result for '{query}': This is a simulated search result."


@tool
def calculator(expression: str) -> str:
    """Evaluate a simple arithmetic expression safely."""
    allowed = set("0123456789+-*/()., ")
    if not all(c in allowed for c in expression):
        return "Error: invalid characters in expression"
    try:
        return str(eval(expression, {"__builtins__": {}}))  # noqa: S307 — demo only
    except Exception as exc:
        return f"Error: {exc}"


# ---------------------------------------------------------------------------
# Node implementations
# ---------------------------------------------------------------------------

llm = ChatOpenAI(
    model="gpt-4o-mini",
    api_key=os.environ["OPENAI_API_KEY"],
)
llm_with_tools = llm.bind_tools([web_search, calculator])


def analyst_node(state: AgentState) -> AgentState:
    """Classifies the user query and decides what to research."""
    messages = state["messages"]
    response = llm.invoke(
        [
            *messages,
            HumanMessage(
                content="Analyse this query. List 2-3 specific things we must research."
            ),
        ]
    )
    return {"messages": [response], "research_notes": "", "final_answer": ""}


def researcher_node(state: AgentState) -> AgentState:
    """Uses tools to gather information."""
    _tools = {"web_search": web_search, "calculator": calculator}
    response = llm_with_tools.invoke(state["messages"])
    new_messages: list = [response]
    notes = ""
    if hasattr(response, "tool_calls") and response.tool_calls:
        for tc in response.tool_calls:
            fn = _tools.get(tc["name"])
            result = fn.invoke(tc["args"]) if fn else f"Unknown tool: {tc['name']}"
            notes += f"\n{result}"
            new_messages.append(ToolMessage(content=str(result), tool_call_id=tc["id"]))
    return {"messages": new_messages, "research_notes": notes, "final_answer": ""}


def synthesizer_node(state: AgentState) -> AgentState:
    """Merges analyst output + research notes into a final answer."""
    notes = state.get("research_notes", "")
    response = llm.invoke(
        [
            *state["messages"],
            HumanMessage(
                content=f"Using these notes: {notes}\n\nWrite a concise final answer."
            ),
        ]
    )
    return {
        "messages": [response],
        "research_notes": notes,
        "final_answer": response.content,
    }


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------


def build_graph() -> StateGraph:
    builder = StateGraph(AgentState)

    builder.add_node("analyst", analyst_node)
    builder.add_node("researcher", researcher_node)
    builder.add_node("synthesizer", synthesizer_node)

    builder.add_edge(START, "analyst")
    builder.add_edge("analyst", "researcher")
    builder.add_edge("researcher", "synthesizer")
    builder.add_edge("synthesizer", END)

    return builder.compile()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run(question: str = "What are the latest breakthroughs in quantum computing?") -> None:
    run_id = f"run-{uuid.uuid4().hex[:8]}"
    print(f"Starting run  : {run_id}")
    print(f"Question      : {question}")
    print(f"Dashboard URL : http://localhost:3000/dashboard?run={run_id}")
    print()

    probe = AgentProbe(run_id=run_id)
    graph = build_graph()

    result = graph.invoke(
        {"messages": [HumanMessage(content=question)]},
        config={"callbacks": [probe]},
    )

    print("\nFinal answer:")
    print(result.get("final_answer") or result["messages"][-1].content)


if __name__ == "__main__":
    run()
