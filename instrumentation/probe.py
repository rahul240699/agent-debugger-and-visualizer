"""
AgentProbe — non-blocking LangGraph / LangChain callback handler.

Intercepts every meaningful lifecycle hook and emits structured TraceEvents
to Redis without adding latency to the agent's hot path.

Captured signals
----------------
• on_chain_start / on_chain_end / on_chain_error  → DAG node lifecycle
• on_llm_start / on_chat_model_start / on_llm_end → token telemetry + monologue
• on_tool_start / on_tool_end / on_tool_error      → tool call tracing

Usage
-----
    from instrumentation import AgentProbe

    probe = AgentProbe(run_id="run-001", redis_url="redis://localhost:6379")
    result = graph.invoke(inputs, config={"callbacks": [probe]})
"""
from __future__ import annotations

import logging
import time
from typing import Any, Optional, Union
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.outputs import LLMResult

from shared.schema.trace_event import (
    EventType,
    NodeStatus,
    Telemetry,
    ToolCall,
    TraceEvent,
    TracePayload,
)
from .diff_engine import StateDiffEngine
from .redis_emitter import RedisEmitter

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_dict(obj: Any) -> dict[str, Any]:
    """Best-effort conversion to a JSON-serialisable dict."""
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "__dict__"):
        return vars(obj)
    return {"_value": str(obj)}


def _extract_monologue(data: Any) -> Optional[str]:
    """
    Attempt to extract internal reasoning text from LLM inputs / messages.
    Checks common keys: internal_monologue, thinking, reasoning, thought.
    Falls back to the last non-trivial message content.
    """
    if not isinstance(data, dict):
        return None
    for key in ("internal_monologue", "thinking", "reasoning", "thought"):
        if key in data:
            value = data[key]
            if isinstance(value, str) and value.strip():
                return value

    messages = data.get("messages", [])
    for msg in reversed(messages):
        if isinstance(msg, BaseMessage):
            content = msg.content
        elif isinstance(msg, dict):
            content = msg.get("content", "")
        else:
            continue
        if isinstance(content, str) and len(content) > 20:
            return content
    return None


# ---------------------------------------------------------------------------
# Probe
# ---------------------------------------------------------------------------


class AgentProbe(BaseCallbackHandler):
    """
    LangGraph / LangChain callback handler that instruments agent execution.

    Parameters
    ----------
    run_id:
        User-assigned identifier for this agent invocation (appears in the UI).
    redis_url:
        Redis connection string.
    emitter:
        Optionally inject a pre-configured :class:`RedisEmitter` (e.g. for
        testing or shared connection pools).
    """

    raise_error = False  # never propagate probe errors to the agent

    def __init__(
        self,
        run_id: str,
        redis_url: str | None = None,
        emitter: Optional[RedisEmitter] = None,
    ) -> None:
        super().__init__()
        self.run_id = run_id
        self._emitter = emitter or RedisEmitter(redis_url)
        self._diff = StateDiffEngine()

        # ── state tracking ──────────────────────────────────────────
        self._sequence = 0
        self._node_visit_counts: dict[str, int] = {}

        # Maps LangChain run_id (str) → our node_id (only langgraph nodes)
        self._run_to_node: dict[str, str] = {}
        # Maps LangChain run_id (str) → parent run_id (str) for ancestry walk
        self._run_to_parent_run: dict[str, str] = {}
        # Maps run_id (str) → wall-clock start time
        self._lc_start_times: dict[str, float] = {}

        # Pending tool call for pairing start → end
        self._pending_tools: dict[str, ToolCall] = {}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _next_seq(self) -> int:
        self._sequence += 1
        return self._sequence

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def _visit(self, node_id: str) -> int:
        """Increment visit count and return the *previous* count (0-based iteration)."""
        prev = self._node_visit_counts.get(node_id, 0)
        self._node_visit_counts[node_id] = prev + 1
        return prev

    def _iteration(self, node_id: str) -> int:
        return max(0, self._node_visit_counts.get(node_id, 1) - 1)

    def _node_for_run(self, run_id: UUID) -> Optional[str]:
        """Return the langgraph node_id for a run, walking up ancestors."""
        rid = str(run_id)
        if rid in self._run_to_node:
            return self._run_to_node[rid]
        parent = self._run_to_parent_run.get(rid)
        while parent:
            if parent in self._run_to_node:
                return self._run_to_node[parent]
            parent = self._run_to_parent_run.get(parent)
        return None

    def _emit(self, event: TraceEvent) -> None:
        self._emitter.emit(event)

    # ------------------------------------------------------------------
    # Chain hooks (maps to LangGraph node lifecycle)
    # ------------------------------------------------------------------

    def on_chain_start(
        self,
        serialized: dict[str, Any],
        inputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[list[str]] = None,
        metadata: Optional[dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        # Always record the parent-run relationship so LLM/tool hooks can
        # walk up the ancestry chain to find their owning langgraph node.
        if parent_run_id:
            self._run_to_parent_run[str(run_id)] = str(parent_run_id)

        # Only emit CHAIN_START for actual LangGraph nodes.
        node_id: Optional[str] = (metadata or {}).get("langgraph_node")
        if not node_id:
            return

        self._run_to_node[str(run_id)] = node_id
        parent = self._run_to_node.get(str(parent_run_id)) if parent_run_id else None
        iteration = self._visit(node_id)
        self._lc_start_times[str(run_id)] = time.time()

        state_delta = self._diff.compute_patch(
            self.run_id, node_id, _safe_dict(inputs)
        )

        self._emit(
            TraceEvent(
                run_id=self.run_id,
                node_id=node_id,
                parent_node_id=parent,
                event_type=EventType.CHAIN_START,
                timestamp_ms=self._now_ms(),
                sequence=self._next_seq(),
                status=NodeStatus.ACTIVE,
                iteration=iteration,
                tags=tags or [],
                payload=TracePayload(
                    internal_monologue=_extract_monologue(inputs),
                    state_delta=state_delta,
                    raw_inputs=_safe_dict(inputs),
                ),
            )
        )

    def on_chain_end(
        self,
        outputs: dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> None:
        node_id = self._run_to_node.pop(str(run_id), None)
        if not node_id:
            return  # internal wrapper chain — not a langgraph node

        start = self._lc_start_times.pop(str(run_id), None)
        latency_ms = int((time.time() - start) * 1000) if start else None
        parent = self._run_to_node.get(str(parent_run_id)) if parent_run_id else None

        state_delta = self._diff.compute_patch(
            self.run_id, node_id, _safe_dict(outputs)
        )

        self._emit(
            TraceEvent(
                run_id=self.run_id,
                node_id=node_id,
                parent_node_id=parent,
                event_type=EventType.CHAIN_END,
                timestamp_ms=self._now_ms(),
                sequence=self._next_seq(),
                status=NodeStatus.SUCCESS,
                iteration=self._iteration(node_id),
                tags=tags or [],
                payload=TracePayload(
                    state_delta=state_delta,
                    raw_outputs=_safe_dict(outputs),
                    telemetry=Telemetry(latency_ms=latency_ms),
                ),
            )
        )

    def on_chain_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[list[str]] = None,
        **kwargs: Any,
    ) -> None:
        node_id = self._run_to_node.pop(str(run_id), None)
        if not node_id:
            return

        self._lc_start_times.pop(str(run_id), None)
        parent = self._run_to_node.get(str(parent_run_id)) if parent_run_id else None

        self._emit(
            TraceEvent(
                run_id=self.run_id,
                node_id=node_id,
                parent_node_id=parent,
                event_type=EventType.CHAIN_END,
                timestamp_ms=self._now_ms(),
                sequence=self._next_seq(),
                status=NodeStatus.ALERT,
                iteration=self._iteration(node_id),
                tags=tags or [],
                payload=TracePayload(error_message=str(error)),
            )
        )

    # ------------------------------------------------------------------
    # LLM hooks
    # ------------------------------------------------------------------

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        if parent_run_id:
            self._run_to_parent_run[str(run_id)] = str(parent_run_id)
        self._lc_start_times[str(run_id)] = time.time()
        node_id = (self._node_for_run(run_id) if parent_run_id else None) or "llm"
        model_name = (
            (serialized or {}).get("name")
            or ((serialized or {}).get("id") or ["unknown"])[-1]
        )

        self._emit(
            TraceEvent(
                run_id=self.run_id,
                node_id=node_id,
                event_type=EventType.LLM_START,
                timestamp_ms=self._now_ms(),
                sequence=self._next_seq(),
                status=NodeStatus.ACTIVE,
                payload=TracePayload(
                    internal_monologue=prompts[-1] if prompts else None,
                    telemetry=Telemetry(model_name=str(model_name)),
                    raw_inputs={"prompts": prompts},
                ),
            )
        )

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[BaseMessage]],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Handle chat-style LLM start (most modern models use this path)."""
        if parent_run_id:
            self._run_to_parent_run[str(run_id)] = str(parent_run_id)
        self._lc_start_times[str(run_id)] = time.time()
        node_id = (self._node_for_run(run_id) if parent_run_id else None) or "llm"
        model_name = (
            (serialized or {}).get("name")
            or ((serialized or {}).get("id") or ["unknown"])[-1]
        )

        # Flatten the last message batch to extract the monologue
        monologue: Optional[str] = None
        if messages:
            for msg in reversed(messages[-1]):
                content = getattr(msg, "content", None)
                if isinstance(content, str) and len(content) > 10:
                    monologue = content
                    break

        self._emit(
            TraceEvent(
                run_id=self.run_id,
                node_id=node_id,
                event_type=EventType.LLM_START,
                timestamp_ms=self._now_ms(),
                sequence=self._next_seq(),
                status=NodeStatus.ACTIVE,
                payload=TracePayload(
                    internal_monologue=monologue,
                    telemetry=Telemetry(model_name=str(model_name)),
                ),
            )
        )

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        start = self._lc_start_times.pop(str(run_id), None)
        latency_ms = int((time.time() - start) * 1000) if start else None
        node_id = self._node_for_run(run_id) or "llm"

        # Extract token usage (OpenAI and Anthropic both use llm_output)
        usage: dict[str, Any] = {}
        if response.llm_output:
            usage = response.llm_output.get(
                "token_usage",
                response.llm_output.get("usage", {}),
            )

        # Extract text / thinking from generations
        monologue: Optional[str] = None
        for gen_list in response.generations:
            for gen in gen_list:
                ak = getattr(getattr(gen, "message", None), "additional_kwargs", {})
                thinking = ak.get("thinking") or ak.get("reasoning_content")
                if thinking:
                    monologue = thinking
                    break
                if getattr(gen, "text", None) and not monologue:
                    monologue = gen.text  # type: ignore[assignment]
            if monologue:
                break

        self._emit(
            TraceEvent(
                run_id=self.run_id,
                node_id=node_id,
                event_type=EventType.LLM_END,
                timestamp_ms=self._now_ms(),
                sequence=self._next_seq(),
                status=NodeStatus.SUCCESS,
                payload=TracePayload(
                    internal_monologue=monologue,
                    telemetry=Telemetry(
                        prompt_tokens=(
                            usage.get("prompt_tokens")
                            or usage.get("input_tokens")
                        ),
                        completion_tokens=(
                            usage.get("completion_tokens")
                            or usage.get("output_tokens")
                        ),
                        total_tokens=usage.get("total_tokens"),
                        latency_ms=latency_ms,
                    ),
                ),
            )
        )

    # ------------------------------------------------------------------
    # Tool hooks
    # ------------------------------------------------------------------

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        if parent_run_id:
            self._run_to_parent_run[str(run_id)] = str(parent_run_id)
        self._lc_start_times[str(run_id)] = time.time()
        tool_name: str = (serialized or {}).get("name", "unknown_tool")
        node_id = (self._node_for_run(run_id) if parent_run_id else None) or tool_name

        try:
            import json as _json

            input_args = (
                _json.loads(input_str)
                if isinstance(input_str, str)
                else input_str
            )
            if not isinstance(input_args, dict):
                input_args = {"input": input_args}
        except Exception:
            input_args = {"input": input_str}

        tool_call = ToolCall(tool_name=tool_name, input_args=input_args)
        self._pending_tools[str(run_id)] = tool_call

        self._emit(
            TraceEvent(
                run_id=self.run_id,
                node_id=node_id,
                event_type=EventType.TOOL_CALL,
                timestamp_ms=self._now_ms(),
                sequence=self._next_seq(),
                status=NodeStatus.ACTIVE,
                payload=TracePayload(tool_calls=[tool_call]),
            )
        )

    def on_tool_end(
        self,
        output: str,
        *,
        run_id: UUID,
        **kwargs: Any,
    ) -> None:
        start = self._lc_start_times.pop(str(run_id), None)
        latency_ms = int((time.time() - start) * 1000) if start else None
        node_id = self._node_for_run(run_id) or "tool"

        pending = self._pending_tools.pop(str(run_id), None)
        tool_call = ToolCall(
            tool_name=pending.tool_name if pending else "unknown",
            input_args=pending.input_args if pending else {},
            output=output,
            latency_ms=latency_ms,
        )

        self._emit(
            TraceEvent(
                run_id=self.run_id,
                node_id=node_id,
                event_type=EventType.TOOL_RESULT,
                timestamp_ms=self._now_ms(),
                sequence=self._next_seq(),
                status=NodeStatus.SUCCESS,
                payload=TracePayload(tool_calls=[tool_call]),
            )
        )

    def on_tool_error(
        self,
        error: Union[Exception, KeyboardInterrupt],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        self._lc_start_times.pop(str(run_id), None)
        node_id = self._node_for_run(run_id) or "tool"
        pending = self._pending_tools.pop(str(run_id), None)

        self._emit(
            TraceEvent(
                run_id=self.run_id,
                node_id=node_id,
                event_type=EventType.TOOL_RESULT,
                timestamp_ms=self._now_ms(),
                sequence=self._next_seq(),
                status=NodeStatus.ALERT,
                payload=TracePayload(
                    tool_calls=[
                        ToolCall(
                            tool_name=pending.tool_name if pending else "unknown",
                            input_args=pending.input_args if pending else {},
                            error=str(error),
                        )
                    ]
                ),
            )
        )
