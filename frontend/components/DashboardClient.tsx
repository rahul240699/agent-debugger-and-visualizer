"use client";

/**
 * DashboardClient — root client component for the debugger UI.
 *
 * Layout
 * ------
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  Header  (run selector + status badge)                         │
 *  ├──────────────┬──────────────────────────────┬───────────────────┤
 *  │  Event Log   │  DAG Canvas (main)           │  Right sidebar    │
 *  │  (scrollable)│                              │  (tabbed panels)  │
 *  └──────────────┴──────────────────────────────┴───────────────────┘
 *  │  Flame Graph (full width, fixed height)                        │
 *  └─────────────────────────────────────────────────────────────────┘
 */

import { useEffect, useState } from "react";
import { useRunStore } from "@/store/useRunStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import DagCanvas from "./DagCanvas";
import EventLog from "./EventLog";
import FlameGraph from "./FlameGraph";
import StateInspector from "./StateInspector";
import CriticPanel from "./CriticPanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type SideTab = "state" | "critic";

export default function DashboardClient() {
  const [runId, setRunIdInput] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [availableRuns, setAvailableRuns] = useState<
    { run_id: string; started_at_ms: number }[]
  >([]);
  const [sideTab, setSideTab] = useState<SideTab>("state");

  const storeRunId = useRunStore((s) => s.runId);
  const nodeCount = useRunStore((s) => Object.keys(s.nodes).length);
  const eventCount = useRunStore((s) => s.events.length);
  const reset = useRunStore((s) => s.reset);
  const setStoreRunId = useRunStore((s) => s.setRunId);

  useWebSocket(activeRunId);

  // Fetch available run list on mount
  useEffect(() => {
    fetch(`${API_URL}/api/runs`)
      .then((r) => r.json())
      .then((data) => setAvailableRuns(data))
      .catch(() => {});
  }, []);

  const handleConnect = () => {
    const id = runId.trim();
    if (!id) return;
    reset();
    setActiveRunId(id);
    setStoreRunId(id);
  };

  const handleSelectRun = (id: string) => {
    reset();
    setRunIdInput(id);
    setActiveRunId(id);
    setStoreRunId(id);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-950 text-gray-100">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <span className="font-semibold text-sm tracking-wide text-indigo-400">
          Agent Debugger
        </span>
        <div className="flex-1 flex items-center gap-2">
          {/* Run ID input */}
          <input
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="run-id (e.g. run-abc123)"
            value={runId}
            onChange={(e) => setRunIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          />
          <button
            onClick={handleConnect}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1 rounded transition"
          >
            Connect
          </button>

          {/* Previous runs dropdown */}
          {availableRuns.length > 0 && (
            <select
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs focus:outline-none"
              defaultValue=""
              onChange={(e) => e.target.value && handleSelectRun(e.target.value)}
            >
              <option value="" disabled>
                Recent runs…
              </option>
              {availableRuns.slice(0, 20).map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {r.run_id} — {new Date(r.started_at_ms).toLocaleTimeString()}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Status badges */}
        {storeRunId && (
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>
              Run:{" "}
              <span className="text-indigo-300 font-mono">{storeRunId}</span>
            </span>
            <span>{nodeCount} nodes</span>
            <span>{eventCount} events</span>
          </div>
        )}
      </header>

      {/* ── Main content area ────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Event Log — left sidebar */}
        <aside className="w-64 shrink-0 border-r border-gray-800 overflow-hidden">
          <EventLog />
        </aside>

        {/* DAG Canvas — centre */}
        <main className="flex-1 min-w-0 relative">
          <DagCanvas />
        </main>

        {/* Right sidebar — State Inspector / Critic */}
        <aside className="w-72 shrink-0 border-l border-gray-800 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-800 shrink-0">
            {(["state", "critic"] as SideTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setSideTab(tab)}
                className={`flex-1 py-1.5 text-xs font-medium capitalize transition ${
                  sideTab === tab
                    ? "text-indigo-400 border-b-2 border-indigo-400"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab === "state" ? "State Inspector" : "Critic"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto">
            {sideTab === "state" ? <StateInspector /> : <CriticPanel />}
          </div>
        </aside>
      </div>

      {/* ── Flame Graph — bottom bar ──────────────────────────────────── */}
      <div className="h-40 shrink-0 border-t border-gray-800 bg-gray-900">
        <FlameGraph />
      </div>
    </div>
  );
}
