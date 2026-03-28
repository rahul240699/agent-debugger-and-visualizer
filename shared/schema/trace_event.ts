/**
 * Shared TypeScript schema — generated from shared/schema/trace_event.py
 * This is the single source of truth for all data structures flowing
 * through the WebSocket from the backend to Module C (frontend).
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type EventType =
  | "CHAIN_START"
  | "CHAIN_END"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "LLM_START"
  | "LLM_END"
  | "STATE_DELTA"
  | "CRITIC_SCORE"
  | "HYDRATE"
  | "INTERRUPT"
  | "RESUME";

export type NodeStatus = "PENDING" | "ACTIVE" | "SUCCESS" | "ALERT" | "INTERRUPTED";

// ---------------------------------------------------------------------------
// Sub-interfaces
// ---------------------------------------------------------------------------

/** RFC 6902 JSON Patch operation */
export interface JsonPatchOp {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  value?: unknown;
  from?: string;
}

export interface ToolCall {
  tool_name: string;
  input_args: Record<string, unknown>;
  output?: unknown;
  latency_ms?: number;
  error?: string;
}

export interface Telemetry {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  latency_ms?: number;
  model_name?: string;
}

export interface CriticScore {
  /** 0.0 = misaligned, 1.0 = fully aligned */
  alignment_score?: number;
  divergence_flag?: boolean;
  reasoning?: string;
}

export interface TracePayload {
  internal_monologue?: string;
  tool_calls: ToolCall[];
  state_delta: JsonPatchOp[];
  telemetry?: Telemetry;
  critic?: CriticScore;
  raw_inputs?: Record<string, unknown>;
  raw_outputs?: Record<string, unknown>;
  error_message?: string;
  /** Present on INTERRUPT events — carries the full graph state at pause time */
  interrupt_state?: {
    interrupted_nodes: string[];
    state: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Top-level TraceEvent
// ---------------------------------------------------------------------------

export interface TraceEvent {
  event_id: string;
  run_id: string;
  node_id: string;
  parent_node_id?: string;
  event_type: EventType;
  timestamp_ms: number;
  /** Monotonic per run_id — allows client-side gap detection */
  sequence: number;
  status: NodeStatus;
  payload: TracePayload;
  /** Loop / retry iteration for this node within the run */
  iteration: number;
  tags: string[];
}

// ---------------------------------------------------------------------------
// WebSocket control messages
// ---------------------------------------------------------------------------

export interface GraphTopology {
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{ source: string; target: string }>;
}

export interface HydrateMessage {
  type: "HYDRATE";
  run_id: string;
  materialized_state: Record<string, unknown>;
  events: TraceEvent[];
  last_sequence: number;
  /** Present for runs started via the Pipeline Builder */
  graph_topology?: GraphTopology;
}

export type WsMessage = TraceEvent | HydrateMessage;
