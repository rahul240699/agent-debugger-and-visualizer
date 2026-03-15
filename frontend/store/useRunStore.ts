"use client";

/**
 * Zustand store for the Agent Debugger UI.
 *
 * Design goals
 * ------------
 * • applyEvent is a pure reducer — deterministic, dedup-safe.
 * • Uses Immer for ergonomic mutable-style updates on plain objects.
 * • State deltas are applied via fast-json-patch to per-node state mirrors.
 * • Retry / loop detection: when node_id is visited again in the same run,
 *   the frontend creates a synthetic node key "{node_id}#iter{N}" and adds
 *   a loopback edge so cycles appear in the DAG.
 */

import { applyPatch } from "fast-json-patch";
import { produce } from "immer";
import { create } from "zustand";

import type {
  CriticScore,
  HydrateMessage,
  JsonPatchOp,
  NodeStatus,
  Telemetry,
  ToolCall,
  TraceEvent,
} from "@/lib/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DagNodeData {
  id: string;
  /** Display label shown inside the DAG node box */
  label: string;
  status: NodeStatus;
  /** 0-based loop iteration (0 = first visit) */
  iteration: number;
  parentId?: string;
  telemetry: Partial<Telemetry>;
  toolCalls: ToolCall[];
  /** Per-node state mirror — RFC 6902 patches applied incrementally */
  stateMirror: Record<string, unknown>;
  critic?: Partial<CriticScore>;
  internalMonologue?: string;
  errorMessage?: string;
  timestampStart?: number;
  timestampEnd?: number;
}

export interface DagEdge {
  id: string;
  source: string;
  target: string;
  /** True for loop-back edges (retry/cycle) */
  isRetry?: boolean;
}

interface RunStore {
  runId: string | null;
  /** node key (may include #iterN suffix) → DagNodeData */
  nodes: Record<string, DagNodeData>;
  edges: DagEdge[];
  events: TraceEvent[];
  /** event_id dedup guard */
  seenIds: Record<string, true>;
  /** node_id → visit count (tracks retries) */
  nodeVisitCounts: Record<string, number>;
  /** ID of the node whose details are shown in side panels */
  selectedNodeId: string | null;

  // Actions
  setRunId: (id: string) => void;
  selectNode: (id: string | null) => void;
  applyEvent: (event: TraceEvent) => void;
  hydrate: (msg: HydrateMessage) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyDelta(
  stateMirror: Record<string, unknown>,
  ops: JsonPatchOp[]
): Record<string, unknown> {
  if (!ops || ops.length === 0) return stateMirror;
  try {
    // fast-json-patch mutates by default — clone first for immutability
    const clone = JSON.parse(JSON.stringify(stateMirror)) as Record<
      string,
      unknown
    >;
    const result = applyPatch(clone, ops as Parameters<typeof applyPatch>[1]);
    return result.newDocument as Record<string, unknown>;
  } catch {
    return stateMirror;
  }
}

function nodeKey(nodeId: string, iteration: number): string {
  return iteration === 0 ? nodeId : `${nodeId}#iter${iteration}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialState = {
  runId: null as string | null,
  nodes: {} as Record<string, DagNodeData>,
  edges: [] as DagEdge[],
  events: [] as TraceEvent[],
  seenIds: {} as Record<string, true>,
  nodeVisitCounts: {} as Record<string, number>,
  selectedNodeId: null as string | null,
};

export const useRunStore = create<RunStore>()((set) => ({
  ...initialState,

  setRunId: (id) => set({ runId: id }),

  selectNode: (id) => set({ selectedNodeId: id }),

  reset: () => set({ ...initialState }),

  hydrate: (msg: HydrateMessage) =>
    set(
      produce((draft) => {
        draft.runId = msg.run_id;
        draft.nodes = {};
        draft.edges = [];
        draft.events = [];
        draft.seenIds = {};
        draft.nodeVisitCounts = {};
        // Replay all historical events in order
        for (const event of msg.events) {
          applyEventMutation(draft, event);
        }
      })
    ),

  applyEvent: (event: TraceEvent) =>
    set(
      produce((draft) => {
        applyEventMutation(draft, event);
      })
    ),
}));

// ---------------------------------------------------------------------------
// Pure reducer (mutates Immer draft)
// ---------------------------------------------------------------------------

function applyEventMutation(draft: typeof initialState, event: TraceEvent) {
  // 1. Dedup
  if (draft.seenIds[event.event_id]) return;
  draft.seenIds[event.event_id] = true;

  // 2. Append to event log (keep ordered by sequence)
  const insertIdx = draft.events.findLastIndex(
    (e) => e.sequence <= event.sequence
  );
  draft.events.splice(insertIdx + 1, 0, event);

  const { node_id, iteration, parent_node_id, event_type, status, payload } =
    event;

  const key = nodeKey(node_id, iteration);

  switch (event_type) {
    case "CHAIN_START": {
      // Track visit count
      draft.nodeVisitCounts[node_id] =
        (draft.nodeVisitCounts[node_id] ?? 0) + 1;

      // Upsert node
      if (!draft.nodes[key]) {
        draft.nodes[key] = {
          id: key,
          label: node_id,
          status: "ACTIVE",
          iteration,
          parentId: parent_node_id ?? undefined,
          telemetry: {},
          toolCalls: [],
          stateMirror: {},
          timestampStart: event.timestamp_ms,
        };
      } else {
        draft.nodes[key].status = "ACTIVE";
        draft.nodes[key].timestampStart = event.timestamp_ms;
      }

      if (payload.internal_monologue) {
        draft.nodes[key].internalMonologue = payload.internal_monologue;
      }

      // Apply state delta
      if (payload.state_delta.length > 0) {
        draft.nodes[key].stateMirror = applyDelta(
          draft.nodes[key].stateMirror,
          payload.state_delta
        );
      }

      // Add edge from parent
      if (parent_node_id) {
        const parentKey = nodeKey(
          parent_node_id,
          draft.nodeVisitCounts[parent_node_id]
            ? draft.nodeVisitCounts[parent_node_id] - 1
            : 0
        );
        const edgeId = `${parentKey}->${key}`;
        if (!draft.edges.find((e) => e.id === edgeId)) {
          // Detect retry: same underlying node_id as parent or already exists
          const isRetry = parent_node_id === node_id;
          draft.edges.push({
            id: edgeId,
            source: parentKey,
            target: key,
            isRetry,
          });
        }
      }
      break;
    }

    case "CHAIN_END": {
      if (!draft.nodes[key]) break;
      draft.nodes[key].status = status;
      draft.nodes[key].timestampEnd = event.timestamp_ms;

      if (payload.telemetry) {
        Object.assign(draft.nodes[key].telemetry, payload.telemetry);
      }
      if (payload.state_delta.length > 0) {
        draft.nodes[key].stateMirror = applyDelta(
          draft.nodes[key].stateMirror,
          payload.state_delta
        );
      }
      if (payload.error_message) {
        draft.nodes[key].errorMessage = payload.error_message;
      }
      break;
    }

    case "LLM_START":
    case "LLM_END": {
      const target = draft.nodes[key];
      if (!target) break;
      if (payload.internal_monologue) {
        target.internalMonologue = payload.internal_monologue;
      }
      if (payload.telemetry) {
        Object.assign(target.telemetry, payload.telemetry);
      }
      break;
    }

    case "TOOL_CALL":
    case "TOOL_RESULT": {
      const target = draft.nodes[key];
      if (!target) break;
      if (payload.tool_calls.length > 0) {
        // Merge: update existing tool entry by name or push new
        for (const tc of payload.tool_calls) {
          const existing = target.toolCalls.findIndex(
            (t) => t.tool_name === tc.tool_name && t.output === undefined
          );
          if (existing >= 0) {
            Object.assign(target.toolCalls[existing], tc);
          } else {
            target.toolCalls.push(tc);
          }
        }
      }
      if (event_type === "TOOL_RESULT") {
        target.status = status;
      }
      break;
    }

    case "CRITIC_SCORE": {
      const target = draft.nodes[key];
      if (!target) break;
      if (payload.critic) {
        target.critic = payload.critic;
      }
      break;
    }

    case "STATE_DELTA": {
      const target = draft.nodes[key];
      if (!target) break;
      if (payload.state_delta.length > 0) {
        target.stateMirror = applyDelta(
          target.stateMirror,
          payload.state_delta
        );
      }
      break;
    }
  }
}
