"use client";

/**
 * StateInspector — shows the raw JSON state mirror and the last RFC 6902 diff
 * for the currently selected DAG node.
 *
 * Uses react-diff-viewer-continued to render adds (green) / removes (red) /
 * changes (yellow) for the state delta.
 */

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useRunStore } from "@/store/useRunStore";

// react-diff-viewer-continued is a CommonJS module — load it client-side only
const ReactDiffViewer = dynamic(
  () => import("react-diff-viewer-continued"),
  { ssr: false }
);

export default function StateInspector() {
  const selectedId = useRunStore((s) => s.selectedNodeId);
  const nodes = useRunStore((s) => s.nodes);
  const events = useRunStore((s) => s.events);

  const node = selectedId ? nodes[selectedId] : null;

  // Find the last STATE_DELTA / CHAIN_END event for this node to show a diff
  const lastDeltaEvent = useMemo(() => {
    if (!selectedId) return null;
    const relevant = events
      .filter(
        (e) =>
          e.node_id === selectedId &&
          e.payload.state_delta.length > 0 &&
          (e.event_type === "CHAIN_END" ||
            e.event_type === "CHAIN_START" ||
            e.event_type === "STATE_DELTA")
      )
      .slice(-1)[0];
    return relevant ?? null;
  }, [selectedId, events]);

  // Reconstruct "before" state by reverse-applying the last patch
  const { before, after } = useMemo(() => {
    if (!node) return { before: "{}", after: "{}" };
    const after = JSON.stringify(node.stateMirror, null, 2);
    if (!lastDeltaEvent || lastDeltaEvent.payload.state_delta.length === 0) {
      return { before: after, after };
    }
    // Show the raw ops as "before" for simplicity
    const opsSummary = JSON.stringify(
      lastDeltaEvent.payload.state_delta,
      null,
      2
    );
    return { before: opsSummary, after };
  }, [node, lastDeltaEvent]);

  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs p-4 text-center">
        Click a node in the DAG to inspect its state.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Node info header */}
      <div className="px-3 py-2 border-b border-gray-800 shrink-0 space-y-0.5">
        <div className="font-mono text-indigo-300 truncate">{node.label}</div>
        <div className="text-gray-500">
          status:{" "}
          <span
            className={
              node.status === "SUCCESS"
                ? "text-emerald-400"
                : node.status === "ALERT"
                  ? "text-red-400"
                  : node.status === "ACTIVE"
                    ? "text-yellow-400"
                    : "text-gray-400"
            }
          >
            {node.status}
          </span>
          {node.iteration > 0 && (
            <span className="ml-2 text-gray-500">iter {node.iteration}</span>
          )}
        </div>
        {node.telemetry.latency_ms != null && (
          <div className="text-gray-500">
            latency: {node.telemetry.latency_ms}ms &nbsp;|&nbsp;
            tokens:{" "}
            {(node.telemetry.prompt_tokens ?? 0) +
              (node.telemetry.completion_tokens ?? 0)}
          </div>
        )}
      </div>

      {/* Internal monologue */}
      {node.internalMonologue && (
        <details className="px-3 py-2 border-b border-gray-800 shrink-0">
          <summary className="cursor-pointer text-gray-400 text-[10px] select-none">
            Internal Monologue
          </summary>
          <p className="mt-1 text-gray-300 text-[10px] whitespace-pre-wrap max-h-28 overflow-auto">
            {node.internalMonologue}
          </p>
        </details>
      )}

      {/* Tool calls */}
      {node.toolCalls.length > 0 && (
        <details className="px-3 py-2 border-b border-gray-800 shrink-0">
          <summary className="cursor-pointer text-gray-400 text-[10px] select-none">
            Tool Calls ({node.toolCalls.length})
          </summary>
          <div className="mt-1 space-y-1 max-h-28 overflow-auto">
            {node.toolCalls.map((tc, i) => (
              <div
                key={i}
                className={`text-[10px] rounded px-1.5 py-1 ${
                  tc.error ? "bg-red-900/30 text-red-300" : "bg-gray-800"
                }`}
              >
                <span className="text-indigo-300">{tc.tool_name}</span>
                {tc.latency_ms != null && (
                  <span className="text-gray-500 ml-1">({tc.latency_ms}ms)</span>
                )}
                {tc.error && (
                  <div className="text-red-400 mt-0.5">{tc.error}</div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* State diff viewer */}
      <div className="flex-1 overflow-auto">
        <div className="px-2 py-1 text-[10px] text-gray-500 border-b border-gray-800 sticky top-0 bg-gray-900">
          {lastDeltaEvent ? "Last delta ops → current state" : "Current state"}
        </div>
        <div className="text-[10px] [&_*]:!text-[10px] [&_*]:!font-mono">
          <ReactDiffViewer
            oldValue={before}
            newValue={after}
            splitView={false}
            useDarkTheme
            hideLineNumbers
            styles={{
              variables: {
                dark: {
                  diffViewerBackground: "#111827",
                  addedBackground: "#052e16",
                  addedColor: "#6ee7b7",
                  removedBackground: "#450a0a",
                  removedColor: "#fca5a5",
                  wordAddedBackground: "#166534",
                  wordRemovedBackground: "#7f1d1d",
                },
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
