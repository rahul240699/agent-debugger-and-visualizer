"use client";

/**
 * StateInspector — live JSON tree of the selected node's current state.
 * Updates in real-time as CHAIN_START / CHAIN_END events arrive.
 */

import { useState } from "react";
import { useRunStore } from "@/store/useRunStore";
import { calcCost, formatCost, costColor, lookupModel } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// State section renderer — one collapsible section per top-level key
// ---------------------------------------------------------------------------

const SKIP_KEYS = new Set(["additional_kwargs", "response_metadata", "id"]);
const TRUNCATE = 300;

type FlatEntry = { key: string; value: string };

function flattenRelative(val: unknown, leafKey: string, out: FlatEntry[]): void {
  if (val === null || val === undefined) {
    out.push({ key: leafKey, value: "null" });
    return;
  }
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    out.push({ key: leafKey, value: String(val) });
    return;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) {
      out.push({ key: leafKey, value: "(empty)" });
      return;
    }
    val.forEach((item, i) => flattenRelative(item, String(i), out));
    return;
  }
  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>).filter(
      ([k]) => !SKIP_KEYS.has(k)
    );
    if (entries.length === 0) {
      out.push({ key: leafKey, value: "(empty)" });
      return;
    }
    entries.forEach(([k, v]) => flattenRelative(v, k, out));
  }
}

function EntryRow({ entryKey, value }: { entryKey: string; value: string }) {
  const [show, setShow] = useState(false);
  const isLong = value.length > TRUNCATE;
  return (
    <div className="flex gap-2 items-baseline min-w-0 py-0.5">
      <span className="text-indigo-300 font-mono shrink-0 text-[10px]">{entryKey}:</span>
      <span className="text-emerald-300 text-[10px] break-all leading-relaxed">
        {isLong && !show ? value.slice(0, TRUNCATE) + "…" : value}
        {isLong && (
          <button
            onClick={() => setShow((x) => !x)}
            className="ml-1 text-[9px] text-gray-500 hover:text-gray-300 underline"
          >
            {show ? "less" : "more"}
          </button>
        )}
      </span>
    </div>
  );
}

function FlatStateView({ state }: { state: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      {Object.entries(state).map(([topKey, topVal]) => {
        const entries: FlatEntry[] = [];
        flattenRelative(topVal, "", entries);
        // single scalar — show inline, no dropdown
        if (entries.length === 1 && entries[0].key === "") {
          return (
            <div key={topKey} className="flex gap-2 items-baseline min-w-0 py-0.5">
              <span className="text-indigo-300 font-mono shrink-0 text-[10px]">{topKey}:</span>
              <span className="text-emerald-300 text-[10px] break-all leading-relaxed">
                {entries[0].value}
              </span>
            </div>
          );
        }
        return (
          <details key={topKey} open className="group">
            <summary className="cursor-pointer select-none list-none flex items-center gap-1 py-0.5">
              <span className="text-gray-500 text-[10px] transition-transform group-open:rotate-90 inline-block">
                ▶
              </span>
              <span className="text-indigo-400 font-mono text-[10px] font-semibold">
                {topKey}
              </span>
              <span className="text-gray-600 text-[9px] ml-1">
                ({entries.length})
              </span>
            </summary>
            <div className="ml-3 pl-2 border-l border-gray-700 mt-0.5 mb-1">
              {entries.map(({ key, value }) => (
                <EntryRow key={key} entryKey={key || "·"} value={value} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StateInspector() {
  const selectedId = useRunStore((s) => s.selectedNodeId);
  const nodes = useRunStore((s) => s.nodes);

  const node = selectedId ? nodes[selectedId] : null;

  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs p-4 text-center">
        Click a node in the DAG to inspect its state.
      </div>
    );
  }

  const hasState = Object.keys(node.stateMirror).length > 0;

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Header */}
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
          <div className="text-gray-500 space-y-0.5">
            <div>
              latency: <span className="text-gray-400">{node.telemetry.latency_ms}ms</span>
            </div>
            {((node.telemetry.prompt_tokens ?? 0) + (node.telemetry.completion_tokens ?? 0)) > 0 && (() => {
              const inp  = node.telemetry.prompt_tokens ?? 0;
              const out  = node.telemetry.completion_tokens ?? 0;
              const cost = calcCost(inp, out, node.telemetry.model_name);
              const label = lookupModel(node.telemetry.model_name)?.label ?? node.telemetry.model_name;
              return (
                <>
                  <div>
                    tokens:{" "}
                    <span className="text-indigo-300 font-mono">
                      {inp.toLocaleString()}
                    </span>
                    {" "}in /{" "}
                    <span className="text-indigo-300 font-mono">
                      {out.toLocaleString()}
                    </span>
                    {" "}out
                  </div>
                  {cost != null && (
                    <div>
                      est. cost:{" "}
                      <span className={`font-mono font-semibold ${costColor(cost)}`}>
                        {formatCost(cost)}
                      </span>
                    </div>
                  )}
                  {label && (
                    <div>
                      model:{" "}
                      <span className="text-gray-400 font-mono text-[9px]">{label}</span>
                    </div>
                  )}
                </>
              );
            })()}
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

      {/* Live state tree */}
      <div className="flex-1 overflow-auto">
        <div className="px-2 py-1 text-[10px] text-gray-500 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          Live state
          {node.status === "ACTIVE" && (
            <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse align-middle" />
          )}
        </div>
        <div className="p-3 font-mono text-[10px] leading-relaxed">
          {hasState ? (
            <FlatStateView state={node.stateMirror} />
          ) : (
            <span className="text-gray-600 italic">
              {node.status === "ACTIVE" ? "Waiting for state…" : "No state captured."}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
