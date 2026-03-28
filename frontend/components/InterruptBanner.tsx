"use client";

/**
 * InterruptBanner — slides up from the bottom of the DAG canvas when a
 * Pipeline Builder run pauses at an interrupt_before node.
 *
 * Two actions:
 *   ▶ Approve & Continue  — resumes without changes
 *   ✎ Edit & Resume       — lets the user modify state fields before resuming
 *
 * Append-only fields (fact_check_notes, domain_notes) are labelled "(→ appends)"
 * because LangGraph's concat reducer will APPEND the submitted value to the
 * existing one rather than replace it.
 */

import { useState } from "react";
import { useRunStore } from "@/store/useRunStore";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Fields whose reducer concatenates rather than replaces
const APPEND_FIELDS = new Set(["fact_check_notes", "domain_notes"]);
// Fields the user can edit (everything except messages and revision_count)
const SKIP_FIELDS = new Set(["messages", "revision_count"]);

export default function InterruptBanner() {
  const interruptInfo  = useRunStore((s) => s.interruptInfo);
  const clearInterrupt = useRunStore((s) => s.clearInterrupt);

  const [editing,    setEditing]    = useState(false);
  const [patches,    setPatches]    = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState("");

  if (!interruptInfo) return null;

  const { runId, nodeIds, state } = interruptInfo;

  const editableEntries = Object.entries(state).filter(
    ([k]) => !SKIP_FIELDS.has(k)
  );

  async function handleAction(action: "approve" | "edit") {
    setSubmitting(true);
    setError("");
    try {
      const body: Record<string, unknown> = { action };
      if (action === "edit") {
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patches)) {
          if (v !== "") patch[k] = v;
        }
        if (Object.keys(patch).length > 0) body.state_patch = patch;
      }
      const res = await fetch(`${API_URL}/api/runs/${runId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(data.detail ?? "Resume failed");
      }
      // Clear interrupt info and exit edit mode
      clearInterrupt();
      setEditing(false);
      setPatches({});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to resume run.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 animate-slide-up">
      <div className="mx-4 mb-4 rounded-xl border border-sky-700/60 bg-gray-950/95 backdrop-blur-sm shadow-[0_-4px_32px_rgba(14,165,233,0.15)] overflow-hidden">

        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-sky-950/60 border-b border-sky-800/40">
          <span className="text-sky-400 text-base">⏸</span>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-sky-300 uppercase tracking-wider">
              Paused
            </span>
            <span className="text-xs text-gray-400 ml-2">
              before{" "}
              <span className="font-mono text-sky-200">
                {nodeIds.join(", ")}
              </span>
            </span>
          </div>
          <button
            onClick={() => { clearInterrupt(); setEditing(false); }}
            className="text-gray-600 hover:text-gray-300 transition text-xs px-1"
            title="Dismiss"
          >
            ✕
          </button>
        </div>

        {/* ── State viewer / editor ────────────────────────────── */}
        <div className="max-h-52 overflow-y-auto px-4 py-3">
          {editableEntries.length === 0 ? (
            <p className="text-gray-600 text-xs">No editable state at this point.</p>
          ) : editing ? (
            /* Edit mode — textareas */
            <div className="space-y-3">
              {editableEntries.map(([key, val]) => {
                const isAppend = APPEND_FIELDS.has(key);
                const placeholder = isAppend
                  ? `${String(val || "").slice(0, 200)}${String(val || "").length > 200 ? "…" : ""}\n\n← appends to existing value`
                  : String(val || "");
                return (
                  <div key={key}>
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-0.5 font-mono">
                      {key}
                      {isAppend && (
                        <span className="text-amber-500/80 text-[9px]">→ appends</span>
                      )}
                    </label>
                    <textarea
                      rows={2}
                      value={patches[key] ?? (isAppend ? "" : String(val || ""))}
                      placeholder={isAppend ? `Append text to the existing value…` : undefined}
                      onChange={(e) =>
                        setPatches((p) => ({ ...p, [key]: e.target.value }))
                      }
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-gray-200 placeholder-gray-600 resize-y focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition"
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            /* Preview mode — compact key-value */
            <div className="space-y-1">
              {editableEntries.map(([key, val]) => {
                const display = String(val || "(empty)");
                const truncated = display.length > 180;
                return (
                  <div key={key} className="flex gap-2 items-baseline min-w-0">
                    <span className="text-indigo-300 font-mono text-[10px] shrink-0 w-32 truncate">
                      {key}
                    </span>
                    <span className="text-gray-400 text-[10px] break-all leading-relaxed">
                      {truncated ? display.slice(0, 180) + "…" : display}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Error ────────────────────────────────────────────── */}
        {error && (
          <div className="px-4 py-1.5 text-[10px] text-red-400 bg-red-950/30 border-t border-red-900/30">
            {error}
          </div>
        )}

        {/* ── Actions ──────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-800/60 bg-gray-900/60">
          {editing ? (
            <>
              <button
                onClick={() => handleAction("edit")}
                disabled={submitting}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition shadow-sm"
              >
                {submitting ? "Resuming…" : "✓ Apply & Resume"}
              </button>
              <button
                onClick={() => { setEditing(false); setPatches({}); }}
                disabled={submitting}
                className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1.5 rounded-lg transition"
              >
                ← Back
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handleAction("approve")}
                disabled={submitting}
                className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition shadow-sm"
              >
                {submitting ? "Resuming…" : "▶ Approve & Continue"}
              </button>
              <button
                onClick={() => { setEditing(true); setPatches({}); }}
                disabled={submitting}
                className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-700 transition"
              >
                ✎ Edit & Resume
              </button>
              <span className="ml-auto text-[10px] text-gray-600">
                Run will remain paused until you choose an action.
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
