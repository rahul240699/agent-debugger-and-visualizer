"""
Isolated, reusable research-pipeline components.

Each component is a standalone LangGraph node that reads from and writes to
ResearchState.  The REGISTRY exposes metadata used by both the backend dynamic
runner and the frontend Component Library UI.

Tools use real public APIs so results are authentic:
  • Wikipedia REST  — free, no key
  • arXiv XML API   — free, no key
  • DuckDuckGo Instant Answer — free, no key
  • Standard math   — built-in
"""
from __future__ import annotations

import json
import math
import os
import re
import urllib.parse
import urllib.request
from typing import Annotated, Any, TypedDict

from langchain_core.messages import HumanMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph.message import add_messages

# ---------------------------------------------------------------------------
# LLM factory
# ---------------------------------------------------------------------------


def _llm() -> ChatOpenAI:
    return ChatOpenAI(model="gpt-4o-mini", api_key=os.environ["OPENAI_API_KEY"])


# ---------------------------------------------------------------------------
# Real API tools
# ---------------------------------------------------------------------------


@tool
def wikipedia_search(query: str) -> str:
    """Look up a topic on Wikipedia and return a concise summary (≤600 chars)."""
    encoded = urllib.parse.quote(query.replace(" ", "_"))
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded}"
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "AgentDebugger/1.0 (portfolio project)"}
        )
        with urllib.request.urlopen(req, timeout=7) as resp:
            data = json.loads(resp.read().decode())
        title = data.get("title", query)
        extract = data.get("extract", "No summary available.")[:600]
        return f"[Wikipedia — {title}]\n{extract}"
    except Exception as exc:
        return f"[Wikipedia] Could not retrieve '{query}': {exc}"


@tool
def arxiv_search(query: str) -> str:
    """Search arXiv for the three most recent papers matching a query.
    Returns titles + 200-char abstract excerpts."""
    encoded = urllib.parse.quote(query)
    url = (
        "http://export.arxiv.org/api/query"
        f"?search_query=all:{encoded}&max_results=3"
        "&sortBy=submittedDate&sortOrder=descending"
    )
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "AgentDebugger/1.0 (portfolio project)"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode()
        # lightweight XML parse — no lxml dependency required
        titles = re.findall(r"<title>(.*?)</title>", raw, re.DOTALL)[1:]
        summaries = re.findall(r"<summary>(.*?)</summary>", raw, re.DOTALL)
        lines = []
        for t, s in zip(titles[:3], summaries[:3]):
            lines.append(f"• {t.strip()}\n  {s.strip()[:200]}…")
        return "[arXiv] " + ("\n".join(lines) if lines else "No results found.")
    except Exception as exc:
        return f"[arXiv] Search failed for '{query}': {exc}"


@tool
def duckduckgo_search(query: str) -> str:
    """Search the web via DuckDuckGo Instant Answer and return the best result."""
    encoded = urllib.parse.quote_plus(query)
    url = (
        f"https://api.duckduckgo.com/?q={encoded}"
        "&format=json&no_html=1&skip_disambig=1"
    )
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "AgentDebugger/1.0 (portfolio project)"}
        )
        with urllib.request.urlopen(req, timeout=7) as resp:
            data = json.loads(resp.read().decode())
        parts: list[str] = []
        if data.get("Answer"):
            parts.append(f"Answer: {data['Answer']}")
        if data.get("AbstractText"):
            parts.append(f"Summary: {data['AbstractText'][:400]}")
        related = [
            r.get("Text", "") for r in data.get("RelatedTopics", [])[:3] if "Text" in r
        ]
        if related:
            parts.append("Related: " + " | ".join(related))
        return "[DuckDuckGo] " + (
            "\n".join(parts) if parts else f"No instant answer for '{query}'."
        )
    except Exception as exc:
        return f"[DuckDuckGo] Search failed for '{query}': {exc}"


@tool
def web_search(query: str) -> str:
    """Search the web for current information on a query (alias for DuckDuckGo)."""
    return duckduckgo_search.invoke({"query": query})


@tool
def fetch_stats(topic: str) -> str:
    """Retrieve key statistics for a topic via Wikipedia."""
    return wikipedia_search.invoke({"query": topic})


@tool
def cite_sources(claim: str) -> str:
    """Find academic sources supporting a claim via arXiv."""
    return arxiv_search.invoke({"query": claim[:120]})


@tool
def calculator(expression: str) -> str:
    """Evaluate a mathematical expression.
    Supports standard math functions: sin, cos, sqrt, log, pow, pi, e, etc.
    Example: 'sqrt(2) * pi' or '2**10 + log(100)'
    """
    safe_globals: dict[str, Any] = {
        k: getattr(math, k) for k in dir(math) if not k.startswith("_")
    }
    safe_globals["__builtins__"] = {}
    try:
        result = eval(expression.replace("^", "**"), safe_globals)  # noqa: S307
        return str(result)
    except Exception as exc:
        return f"Error evaluating '{expression}': {exc}"


# ---------------------------------------------------------------------------
# Tool map
# ---------------------------------------------------------------------------

ALL_TOOLS = [
    wikipedia_search,
    arxiv_search,
    duckduckgo_search,
    web_search,
    fetch_stats,
    cite_sources,
    calculator,
]
_TOOL_MAP = {t.name: t for t in ALL_TOOLS}


# ---------------------------------------------------------------------------
# Shared state schema
# ---------------------------------------------------------------------------


class ResearchState(TypedDict):
    messages: Annotated[list, add_messages]
    topic: str
    fact_check_notes: str
    domain_notes: str
    aggregated_draft: str
    critic_verdict: str  # "approve" | "revise"
    revision_notes: str
    final_answer: str
    revision_count: int


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------


def _exec_tools(response: Any) -> tuple[list, str]:
    """Run any tool_calls in an LLM response; return (new_messages, combined_notes)."""
    messages: list = [response]
    notes = ""
    if getattr(response, "tool_calls", None):
        for tc in response.tool_calls:
            fn = _TOOL_MAP.get(tc["name"])
            result = fn.invoke(tc["args"]) if fn else f"Unknown tool: {tc['name']}"
            notes += f"\n{result}"
            messages.append(ToolMessage(content=str(result), tool_call_id=tc["id"]))
    return messages, notes


# ---------------------------------------------------------------------------
# Node implementations
# ---------------------------------------------------------------------------


def _planner(state: ResearchState) -> dict:
    """Break the topic into research tracks."""
    response = _llm().invoke([
        HumanMessage(content=(
            f"Topic: {state['topic']}\n\n"
            "You are a research planner. Output a concise plan with:\n"
            "1. Key facts to verify\n"
            "2. Domain-specific angles to explore\n"
            "Keep it to 3-4 bullets each."
        ))
    ])
    return {"messages": [response]}


def _fact_checker(state: ResearchState) -> dict:
    """Verify core facts with real web search and citations."""
    llm_t = _llm().bind_tools([web_search, wikipedia_search, cite_sources])
    response = llm_t.invoke([
        *state["messages"],
        HumanMessage(content=(
            f"Fact-check the research plan for topic: {state['topic']}.\n"
            "Use web_search, wikipedia_search, and cite_sources to verify key claims."
        )),
    ])
    msgs, notes = _exec_tools(response)
    return {"messages": msgs, "fact_check_notes": notes}


def _domain_expert(state: ResearchState) -> dict:
    """Deep-dive with real statistics and arXiv papers."""
    llm_t = _llm().bind_tools([fetch_stats, arxiv_search, web_search])
    response = llm_t.invoke([
        *state["messages"],
        HumanMessage(content=(
            f"You are a domain expert on: {state['topic']}.\n"
            "Use fetch_stats, arxiv_search, and web_search for data, numbers, and context."
        )),
    ])
    msgs, notes = _exec_tools(response)
    return {"messages": msgs, "domain_notes": notes}


def _aggregator(state: ResearchState) -> dict:
    """Merge fact-check + domain notes into a structured draft."""
    combined = (
        f"Fact-check findings:\n{state.get('fact_check_notes') or 'N/A'}\n\n"
        f"Domain expert findings:\n{state.get('domain_notes') or 'N/A'}"
    )
    response = _llm().invoke([
        *state["messages"],
        HumanMessage(content=(
            f"Synthesise the research into a structured draft about '{state['topic']}':\n\n"
            f"{combined}\n\nOutput: 3-4 well-structured paragraphs."
        )),
    ])
    return {"messages": [response], "aggregated_draft": response.content}


def _critic_review(state: ResearchState) -> dict:
    """Quality gate: approve or request revision."""
    draft = state.get("aggregated_draft") or "No draft yet."
    response = _llm().invoke([
        HumanMessage(content=(
            f"Review this draft about '{state['topic']}':\n\n{draft}\n\n"
            "Is it accurate, complete, and well-written?\n"
            "Reply with APPROVE or REVISE on the first line, "
            "then 2-3 sentences explaining why."
        ))
    ])
    verdict = "approve" if response.content.strip().upper().startswith("APPROVE") else "revise"
    return {"messages": [response], "critic_verdict": verdict}


def _revise(state: ResearchState) -> dict:
    """Apply critic feedback to improve the draft."""
    last_msg = state["messages"][-1].content if state["messages"] else ""
    response = _llm().invoke([
        *state["messages"],
        HumanMessage(content=(
            f"The critic requested revision for '{state['topic']}'.\n"
            f"Critic notes: {last_msg}\n\n"
            f"Original draft:\n{state.get('aggregated_draft', '')}\n\n"
            "Produce an improved version that addresses all concerns."
        )),
    ])
    return {
        "messages": [response],
        "aggregated_draft": response.content,
        "revision_notes": response.content,
        "revision_count": state.get("revision_count", 0) + 1,
        "critic_verdict": "approve",
    }


def _web_researcher(state: ResearchState) -> dict:
    """General-purpose node — DuckDuckGo + Wikipedia + arXiv combined."""
    llm_t = _llm().bind_tools([web_search, wikipedia_search, arxiv_search])
    response = llm_t.invoke([
        HumanMessage(content=(
            f"Research the topic: {state['topic']}\n"
            "Use web_search, wikipedia_search, and arxiv_search to gather "
            "comprehensive, up-to-date information."
        ))
    ])
    msgs, notes = _exec_tools(response)
    existing = state.get("fact_check_notes") or ""
    return {"messages": msgs, "fact_check_notes": (existing + "\n" + notes).strip()}


def _summarizer(state: ResearchState) -> dict:
    """Condense all accumulated messages into a concise, structured summary."""
    history = "\n\n".join(
        m.content
        for m in state.get("messages", [])
        if hasattr(m, "content") and m.content
    )
    response = _llm().invoke([
        HumanMessage(content=(
            f"Summarise the following research about '{state['topic']}':\n\n"
            f"{history[:4000]}\n\n"
            "Output a concise, well-structured summary (2-3 paragraphs)."
        ))
    ])
    return {"messages": [response], "aggregated_draft": response.content}


def _finalize(state: ResearchState) -> dict:
    """Polish and format the final answer."""
    source = (
        state.get("aggregated_draft")
        or (state["messages"][-1].content if state.get("messages") else state["topic"])
    )
    response = _llm().invoke([
        HumanMessage(content=(
            f"Final polish for: '{state['topic']}':\n\n{source}\n\n"
            "Format with a title, 3-4 paragraphs, and a one-sentence summary at the end."
        ))
    ])
    return {"messages": [response], "final_answer": response.content}


# ---------------------------------------------------------------------------
# Component Registry  (consumed by frontend /api/components)
# ---------------------------------------------------------------------------

REGISTRY: dict[str, dict] = {
    "planner": {
        "label": "Research Planner",
        "description": "Breaks the topic into key facts to verify and domain angles to explore.",
        "color": "indigo",
        "reads": ["topic"],
        "writes": ["messages"],
        "tools": [],
        "fn": _planner,
    },
    "fact_checker": {
        "label": "Fact Checker",
        "description": "Verifies claims using DuckDuckGo, Wikipedia, and arXiv citations.",
        "color": "blue",
        "reads": ["topic", "messages"],
        "writes": ["fact_check_notes"],
        "tools": ["web_search", "wikipedia_search", "cite_sources"],
        "fn": _fact_checker,
    },
    "domain_expert": {
        "label": "Domain Expert",
        "description": "Deep-dives into domain data, statistics, and recent academic papers.",
        "color": "violet",
        "reads": ["topic", "messages"],
        "writes": ["domain_notes"],
        "tools": ["fetch_stats", "arxiv_search", "web_search"],
        "fn": _domain_expert,
    },
    "aggregator": {
        "label": "Aggregator",
        "description": "Merges fact-check and domain findings into a cohesive draft.",
        "color": "amber",
        "reads": ["topic", "fact_check_notes", "domain_notes"],
        "writes": ["aggregated_draft"],
        "tools": [],
        "fn": _aggregator,
    },
    "web_researcher": {
        "label": "Web Researcher",
        "description": "General-purpose research node combining DuckDuckGo, Wikipedia, and arXiv.",
        "color": "cyan",
        "reads": ["topic"],
        "writes": ["fact_check_notes"],
        "tools": ["web_search", "wikipedia_search", "arxiv_search"],
        "fn": _web_researcher,
    },
    "summarizer": {
        "label": "Summarizer",
        "description": "Condenses all accumulated research into a concise, structured summary.",
        "color": "teal",
        "reads": ["messages", "topic"],
        "writes": ["aggregated_draft"],
        "tools": [],
        "fn": _summarizer,
    },
    "critic_review": {
        "label": "Critic Review",
        "description": "Quality gate: reads the draft and decides to approve or request revision.",
        "color": "orange",
        "reads": ["topic", "aggregated_draft"],
        "writes": ["critic_verdict"],
        "tools": [],
        "fn": _critic_review,
    },
    "revise": {
        "label": "Reviser",
        "description": "Applies critic feedback to produce an improved version of the draft.",
        "color": "rose",
        "reads": ["topic", "aggregated_draft", "messages"],
        "writes": ["aggregated_draft", "revision_notes"],
        "tools": [],
        "fn": _revise,
    },
    "finalize": {
        "label": "Finalizer",
        "description": "Polishes and formats the final answer with a title and closing summary.",
        "color": "emerald",
        "reads": ["aggregated_draft"],
        "writes": ["final_answer"],
        "tools": [],
        "fn": _finalize,
    },
}
