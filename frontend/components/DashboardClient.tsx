"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRunStore } from "@/store/useRunStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import DagCanvas from "./DagCanvas";
import EventLog from "./EventLog";
import FlameGraph from "./FlameGraph";
import StateInspector from "./StateInspector";
import CriticPanel from "./CriticPanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type SideTab = "state" | "critic";

const WS_STATUS: Record<string, { dot: string; label: string }> = {
  connected:    { dot: "bg-emerald-400",              label: "Live"         },
  connecting:   { dot: "bg-yellow-400 animate-pulse", label: "Connecting"   },
  disconnected: { dot: "bg-gray-600",                 label: "Disconnected" },
};

export default function DashboardClient() {
  const [runId, setRunIdInput]         = useState("");
  const [activeRunId, setActiveRunId]  = useState<string | null>(null);
  const [availableRuns, setAvailableRuns] = useState<
    { run_id: string; started_at_ms: number }[]
  >([]);
  const [sideTab, setSideTab]   = useState<SideTab>("state");
  const [runsOpen, setRunsOpen] = useState(false);
  const [wsStatus, setWsStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const storeRunId    = useRunStore((s) => s.runId);
  const nodeCount     = useRunStore((s) => Object.keys(s.nodes).length);
  const eventCount    = useRunStore((s) => s.events.length);
  const reset         = useRunStore((s) => s.reset);
  const setStoreRunId = useRunStore((s) => s.setRunId);

  useWebSocket(activeRunId);

  // Auto-read ?run= from URL on first render
  useEffect(() => {
    const params   = new URLSearchParams(window.location.search);
    const runParam = params.get("run");
    if (runParam) {
      setRunIdInput(runParam);
      reset();
      setActiveRunId(runParam);
      setStoreRunId(runParam);
      setWsStatus("connecting");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flip to "connected" shortly after a run is activated
  useEffect(() => {
    if (!activeRunId) return;
    const t = setTimeout(() => setWsStatus("connected"), 1400);
    return () => clearTimeout(t);
  }, [activeRunId]);

  // Fetch run list
  useEffect(() => {
    fetch(`${API_URL}/api/runs`)
      .then((r) => r.json())
      .then((data) => setAvailableRuns(data))
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setRunsOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleConnect = () => {
    const id = runId.trim();
    if (!id) return;
    reset();
    setActiveRunId(id);
    setStoreRunId(id);
    setWsStatus("connecting");
    setRunsOpen(false);
  };

  const handleSelectRun = (id: string) => {
    reset();
    setRunIdInput(id);
    setActiveRunId(id);
    setStoreRunId(id);
    setWsStatus("connecting");
    setRunsOpen(false);
  };

  const ws = WS_STATUS[wsStatus];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-950 text-gray-100">

      {/* ── Header ────────────────────────────────────────────────── */}
      {/* z-10 + relative ensures the dropdown floats above the React Flow canvas */}
      <header className="relative z-10 flex items-center gap-4 px-5 py-2.5 bg-gray-900 border-b border-gray-800/80 shrink-0">

        {/* Logo / back-to-home */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold select-none shadow-sm group-hover:opacity-90 transition-opacity">
            A
          </div>
          <span className="hidden sm:block text-sm font-semibold text-gray-100 group-hover:text-white transition-colors tracking-tight">
            Agent Debugger
          </span>
        </Link>

        <div className="w-px h-5 bg-gray-800 shrink-0" />

        {/* Run input + connect */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <input
            className="bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-1.5 text-xs w-52 font-mono placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 transition"
            placeholder="run-id  (e.g. run-abc123)"
            value={runId}
            onChange={(e) => setRunIdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
          />
          <button
            onClick={handleConnect}
            className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition shadow-sm shrink-0"
          >
            Connect
          </button>

          {/* Recent runs — custom dropdown (replaces <select>) */}
          {availableRuns.length > 0 && (
            <div className="relative shrink-0" ref={dropdownRef}>
              <button
                onClick={() => setRunsOpen((x) => !x)}
                className="flex items-center gap-1.5 bg-gray-800/80 border border-gray-700 hover:border-gray-600 rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition"
              >
                Recent
                <svg
                  className={`w-3 h-3 transition-transform ${runsOpen ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {runsOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-72 bg-gray-900 border border-gray-750 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-50 overflow-hidden">
                  <div className="px-3 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wider border-b border-gray-800">
                    Recent runs
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {availableRuns.slice(0, 20).map((r) => (
                      <button
                        key={r.run_id}
                        onClick={() => handleSelectRun(r.run_id)}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-800/80 transition ${
                          storeRunId === r.run_id
                            ? "bg-indigo-950/60 text-indigo-300"
                            : "text-gray-300"
                        }`}
                      >
                        <span className="font-mono text-xs truncate">{r.run_id}</span>
                        <span className="text-[10px] text-gray-600 shrink-0 ml-2">
                          {new Date(r.started_at_ms).toLocaleTimeString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: run info + WS status */}
        <div className="flex items-center gap-3 shrink-0">
          {storeRunId && (
            <div className="hidden md:flex items-center gap-1.5 text-[11px] bg-gray-800/60 border border-gray-700/50 rounded-lg px-2.5 py-1">
              <span className="text-gray-500">Run</span>
              <span className="text-indigo-300 font-mono max-w-[144px] truncate">{storeRunId}</span>
              {nodeCount > 0 && (
                <>
                  <span className="text-gray-700">·</span>
                  <span className="text-gray-400">{nodeCount}n / {eventCount}e</span>
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[11px] text-gray-400 border border-gray-700/50 rounded-full bg-gray-800/40 px-2.5 py-1">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ws.dot}`} />
            <span>{ws.label}</span>
          </div>
        </div>
      </header>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Event log — narrow left sidebar */}
        <aside className="w-52 shrink-0 border-r border-gray-800/80 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <EventLog />
          </div>
        </aside>

        {/* DAG canvas */}
        <main className="flex-1 min-w-0 relative bg-[#080810]">
          {!activeRunId && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
              <div className="text-6xl opacity-[0.04] select-none">◈</div>
              <p className="text-gray-700 text-sm">No active run</p>
              <Link
                href="/"
                className="pointer-events-auto text-indigo-500 hover:text-indigo-400 text-xs transition"
              >
                ← Start a new run
              </Link>
            </div>
          )}
          <DagCanvas />
        </main>

        {/* State Inspector / Critic sidebar */}
        <aside className="w-72 shrink-0 border-l border-gray-800/80 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-800/80 shrink-0 bg-gray-900">
            {(["state", "critic"] as SideTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setSideTab(tab)}
                className={`relative flex-1 py-2 text-xs font-medium transition-colors ${
                  sideTab === tab
                    ? "text-indigo-400"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab === "state" ? "State Inspector" : "Critic"}
                {sideTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t" />
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-auto">
            {sideTab === "state" ? <StateInspector /> : <CriticPanel />}
          </div>
        </aside>
      </div>

      {/* ── Flame graph ───────────────────────────────────────────── */}
      <div className="h-24 shrink-0 border-t border-gray-800/80 bg-gray-900">
        <FlameGraph />
      </div>
    </div>
  );
}
