/**
 * Re-exports the shared TypeScript schema so frontend modules can import from
 *   @/lib/schema
 * rather than from the monorepo root (keeping the frontend self-contained).
 */
export type {
  EventType,
  NodeStatus,
  JsonPatchOp,
  ToolCall,
  Telemetry,
  CriticScore,
  TracePayload,
  TraceEvent,
  GraphTopology,
  HydrateMessage,
  WsMessage,
} from "../../shared/schema/trace_event";
