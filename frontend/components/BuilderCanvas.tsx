"use client";

/**
 * BuilderCanvas — visual pipeline builder.
 *
 * Layout
 * ──────
 *  ┌──── left palette ─────┬──────── React Flow canvas ────────┐
 *  │  Component cards      │  Drag, connect, delete nodes      │
 *  │  (click to add)       │                                   │
 *  │                       │                                   │
 *  │  Topic input          │                                   │
 *  │  [Run →]              │                                   │
 *  └───────────────────────┴───────────────────────────────────┘
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  BuilderNodeComponent,
  type BuilderNodeData,
} from "./BuilderNode";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const NODE_TYPES = { builderNode: BuilderNodeComponent };

// ── colour helpers for the palette cards ─────────────────────────────────────
const PALETTE_COLOR: Record<string, string> = {
  indigo:  "border-indigo-700/60 bg-indigo-950/30 hover:bg-indigo-950/60",
  blue:    "border-blue-700/60 bg-blue-950/30 hover:bg-blue-950/60",
  violet:  "border-violet-700/60 bg-violet-950/30 hover:bg-violet-950/60",
  amber:   "border-amber-700/60 bg-amber-950/30 hover:bg-amber-950/60",
  cyan:    "border-cyan-700/60 bg-cyan-950/30 hover:bg-cyan-950/60",
  teal:    "border-teal-700/60 bg-teal-950/30 hover:bg-teal-950/60",
  orange:  "border-orange-700/60 bg-orange-950/30 hover:bg-orange-950/60",
  rose:    "border-rose-700/60 bg-rose-950/30 hover:bg-rose-950/60",
  emerald: "border-emerald-700/60 bg-emerald-950/30 hover:bg-emerald-950/60",
};

const DOT_COLOR: Record<string, string> = {
  indigo:  "bg-indigo-500",
  blue:    "bg-blue-500",
  violet:  "bg-violet-500",
  amber:   "bg-amber-500",
  cyan:    "bg-cyan-500",
  teal:    "bg-teal-500",
  orange:  "bg-orange-500",
  rose:    "bg-rose-500",
  emerald: "bg-emerald-500",
};

interface ComponentMeta {
  key: string;
  label: string;
  description: string;
  color: string;
  reads: string[];
  writes: string[];
  tools: string[];
}

// Track how many instances of each type we've placed
const instanceCounts: Record<string, number> = {};

let nodeIdCounter = 0;
function nextNodeId() {
  return `node-${++nodeIdCounter}`;
}

function gridPosition(total: number) {
  // Waterfall down-centre starting position, offset for each new node
  const col = Math.floor(total / 8);
  const row = total % 8;
  return { x: 260 + col * 280, y: 60 + row * 220 };
}

export default function BuilderCanvas() {
  const router = useRouter();
  const [components, setComponents] = useState<ComponentMeta[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);

  // Fetch component registry
  useEffect(() => {
    fetch(`${API}/api/components`)
      .then((r) => r.json())
      .then(setComponents)
      .catch(() => setError("Could not load component registry."));
  }, []);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: "#6366f1", strokeWidth: 2 },
          },
          eds
        )
      ),
    [setEdges]
  );

  function addComponent(meta: ComponentMeta) {
    const count = instanceCounts[meta.key] ?? 0;
    instanceCounts[meta.key] = count + 1;
    const id = nextNodeId();

    const newNode: Node = {
      id,
      type: "builderNode",
      position: gridPosition(nodes.length),
      data: {
        componentKey: meta.key,
        label: meta.label,
        description: meta.description,
        color: meta.color,
        reads: meta.reads,
        writes: meta.writes,
        tools: meta.tools,
        instanceIndex: count,
      } satisfies BuilderNodeData,
    };

    setNodes((nds) => [...nds, newNode]);
    setValidation("");
  }

  async function handleRun() {
    const t = topic.trim();
    if (!t) {
      setValidation("Please enter a research topic.");
      return;
    }
    if (nodes.length === 0) {
      setValidation("Add at least one component to the canvas.");
      return;
    }

    setLoading(true);
    setError("");
    setValidation("");

    const nodeSpecs = nodes.map((n) => ({
      id: n.id,
      type: (n.data as BuilderNodeData).componentKey,
    }));
    const edgeSpecs = edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    try {
      const res = await fetch(`${API}/api/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t, nodes: nodeSpecs, edges: edgeSpecs }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(body.detail ?? "Build failed");
      }
      const { run_id } = await res.json();
      router.push(`/dashboard?run=${run_id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start run.");
      setLoading(false);
    }
  }

  function handleClear() {
    setNodes([]);
    setEdges([]);
    setValidation("");
    Object.keys(instanceCounts).forEach((k) => delete instanceCounts[k]);
    nodeIdCounter = 0;
  }

  return (
    <div className="flex h-full bg-gray-950 text-gray-100">
      {/* ── Left palette ────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 border-r border-gray-800/80 flex flex-col overflow-hidden bg-gray-900">
        {/* Section: component library */}
        <div className="px-4 pt-4 pb-2 border-b border-gray-800/80 shrink-0">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-0.5">
            Components
          </p>
          <p className="text-[10px] text-gray-700">
            Click a card to add it to the canvas
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {components.length === 0 && (
            <p className="text-[11px] text-gray-700 text-center py-4">Loading…</p>
          )}
          {components.map((comp) => (
            <button
              key={comp.key}
              onClick={() => addComponent(comp)}
              className={`
                w-full text-left rounded-lg border px-3 py-2.5 transition-all
                ${PALETTE_COLOR[comp.color] ?? PALETTE_COLOR.indigo}
              `}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${DOT_COLOR[comp.color] ?? "bg-indigo-500"}`}
                />
                <span className="text-xs font-semibold text-gray-200">
                  {comp.label}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed line-clamp-2">
                {comp.description}
              </p>
              {comp.tools.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {comp.tools.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="text-[8px] font-mono bg-gray-800/60 text-gray-600 rounded px-1 py-0.5"
                    >
                      🔧 {t}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Section: run controls */}
        <div className="px-4 py-4 border-t border-gray-800/80 space-y-3 shrink-0">
          <div>
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest block mb-1.5">
              Research Topic
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Advances in solid-state batteries"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                setValidation("");
              }}
              className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          {(validation || error) && (
            <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-800/40 rounded px-2.5 py-1.5">
              {validation || error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleRun}
              disabled={loading}
              className={`
                flex-1 py-2 rounded-lg text-xs font-semibold transition-all
                ${!loading
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm"
                  : "bg-gray-800 text-gray-600 cursor-not-allowed"
                }
              `}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
                  Running…
                </span>
              ) : (
                "Run pipeline →"
              )}
            </button>
            <button
              onClick={handleClear}
              disabled={loading}
              className="px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-gray-300 border border-gray-700/60 hover:border-gray-600 transition"
              title="Clear canvas"
            >
              ✕
            </button>
          </div>

          <p className="text-[10px] text-gray-700 leading-relaxed">
            {nodes.length} node{nodes.length !== 1 ? "s" : ""} ·{" "}
            {edges.length} edge{edges.length !== 1 ? "s" : ""}
          </p>
        </div>
      </aside>

      {/* ── Canvas ──────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0" ref={canvasRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          deleteKeyCode="Backspace"
          style={{ background: "#060610" }}
          defaultEdgeOptions={{
            animated: true,
            style: { stroke: "#4f46e5", strokeWidth: 2 },
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="#1e1e2e"
          />
          <Controls
            className="!bg-gray-900 !border-gray-700 !rounded-xl"
            showInteractive={false}
          />
          <MiniMap
            nodeColor={(n) => {
              const color = (n.data as BuilderNodeData | undefined)?.color ?? "indigo";
              const map: Record<string, string> = {
                indigo: "#6366f1", blue: "#3b82f6", violet: "#8b5cf6",
                amber: "#f59e0b", cyan: "#06b6d4", teal: "#14b8a6",
                orange: "#f97316", rose: "#f43f5e", emerald: "#10b981",
              };
              return map[color] ?? "#6366f1";
            }}
            className="!bg-gray-900 !border-gray-800 !rounded-xl"
          />

          {/* Empty state overlay */}
          {nodes.length === 0 && (
            <Panel position="top-center">
              <div className="mt-16 flex flex-col items-center gap-3 pointer-events-none select-none">
                <div className="text-5xl opacity-[0.06]">⬡</div>
                <p className="text-gray-700 text-sm">
                  Click a component on the left to add it here
                </p>
                <p className="text-gray-800 text-xs">
                  Then drag node handles to connect them, and hit Run →
                </p>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  );
}
