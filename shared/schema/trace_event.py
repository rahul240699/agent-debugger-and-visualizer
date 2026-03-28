"""
Shared Pydantic v2 schema — the single source of truth for all TraceEvent
structures shared between Module A (probe), Module B (backend), and the
TypeScript interfaces consumed by Module C (frontend).
"""
from __future__ import annotations

import uuid
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class EventType(str, Enum):
    CHAIN_START = "CHAIN_START"
    CHAIN_END = "CHAIN_END"
    TOOL_CALL = "TOOL_CALL"
    TOOL_RESULT = "TOOL_RESULT"
    LLM_START = "LLM_START"
    LLM_END = "LLM_END"
    STATE_DELTA = "STATE_DELTA"
    CRITIC_SCORE = "CRITIC_SCORE"
    HYDRATE = "HYDRATE"
    INTERRUPT = "INTERRUPT"
    RESUME = "RESUME"


class NodeStatus(str, Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    SUCCESS = "SUCCESS"
    ALERT = "ALERT"
    INTERRUPTED = "INTERRUPTED"


# ---------------------------------------------------------------------------
# Sub-models
# ---------------------------------------------------------------------------


class JsonPatchOp(BaseModel):
    """RFC 6902 JSON Patch operation."""

    op: str  # "add" | "remove" | "replace" | "move" | "copy" | "test"
    path: str
    value: Optional[Any] = None
    from_path: Optional[str] = Field(None, alias="from")

    model_config = {"populate_by_name": True}


class ToolCall(BaseModel):
    tool_name: str
    input_args: dict[str, Any]
    output: Optional[Any] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None


class Telemetry(BaseModel):
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    latency_ms: Optional[int] = None
    model_name: Optional[str] = None


class CriticScore(BaseModel):
    """
    Populated asynchronously by the background Critic LLM worker.
    alignment_score: 0.0 (misaligned) to 1.0 (fully aligned).
    divergence_flag: True when the agent deviated from expected behaviour.
    """

    alignment_score: Optional[float] = Field(None, ge=0.0, le=1.0)
    divergence_flag: Optional[bool] = None
    reasoning: Optional[str] = None


class TracePayload(BaseModel):
    internal_monologue: Optional[str] = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    state_delta: list[JsonPatchOp] = Field(default_factory=list)
    telemetry: Optional[Telemetry] = None
    critic: Optional[CriticScore] = None
    raw_inputs: Optional[dict[str, Any]] = None
    raw_outputs: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    # Present on INTERRUPT events — carries the full graph state at pause time
    interrupt_state: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Top-level TraceEvent
# ---------------------------------------------------------------------------


class TraceEvent(BaseModel):
    """
    One unit of observability data emitted by the probe and streamed to
    the frontend via Redis → WebSocket.
    """

    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    run_id: str
    node_id: str
    parent_node_id: Optional[str] = None
    event_type: EventType
    timestamp_ms: int
    sequence: int  # monotonic per run_id — allows client-side gap detection
    status: NodeStatus = NodeStatus.PENDING
    payload: TracePayload = Field(default_factory=TracePayload)
    iteration: int = Field(
        default=0,
        description="Loop / retry iteration count for this node within the run.",
    )
    tags: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# WebSocket control messages
# ---------------------------------------------------------------------------


class HydrateMessage(BaseModel):
    """
    Sent to late-joining WebSocket clients so they can reconstruct the
    current DAG state before switching to delta mode.
    """

    type: str = "HYDRATE"
    run_id: str
    materialized_state: dict[str, Any]
    events: list[TraceEvent]
    last_sequence: int
