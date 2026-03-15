"use client";

/**
 * DagCanvas — React Flow canvas that renders the live agent execution DAG.
 *
 * Features
 * --------
 * • Dagre auto-layout (top-bottom) recomputed whenever nodes/edges change.
 * • Custom DagNodeComponent with 4 visual states.
 * • Retry / loop edges rendered as dashed animated curves.
 * • Parallel branches and merge nodes handled naturally by React Flow.
 */

import { useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";

import { useRunStore, type DagNodeData } from "@/store/useRunStore";
import { DagNodeComponent } from "./DagNode";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

const nodeTypes = { dagNode: DagNodeComponent };

// ---------------------------------------------------------------------------
// Dagre layout helper
// ---------------------------------------------------------------------------

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[]
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90, edgesep: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return {
    nodes: nodes.map((node) => {
      const { x, y } = g.node(node.id);
      return {
        ...node,
        position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      };
    }),
    edges,
  };
}

// ---------------------------------------------------------------------------
// Conversion: Zustand store → React Flow nodes / edges
// ---------------------------------------------------------------------------

function storeToFlowElements(
  storeNodes: Record<string, DagNodeData>,
  storeEdges: { id: string; source: string; target: string; isRetry?: boolean }[],
  selectedId: string | null
): { nodes: Node[]; edges: Edge[] } {
  const rfNodes: Node[] = Object.values(storeNodes).map((n) => ({
    id: n.id,
    type: "dagNode",
    position: { x: 0, y: 0 }, // overwritten by dagre
    data: { ...n, selected: n.id === selectedId },
    style: { border: "none", background: "transparent" },
  }));

  const rfEdges: Edge[] = storeEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.isRetry,
    style: {
      stroke: e.isRetry ? "#F59E0B" : "#4B5563",
      strokeDasharray: e.isRetry ? "5 3" : undefined,
      strokeWidth: 2,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: e.isRetry ? "#F59E0B" : "#4B5563",
    },
    label: e.isRetry ? "retry" : undefined,
    labelStyle: { fontSize: 9, fill: "#9CA3AF" },
    labelBgStyle: { fill: "transparent" },
  }));

  return rfNodes.length > 0 ? getLayoutedElements(rfNodes, rfEdges) : { nodes: rfNodes, edges: rfEdges };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DagCanvas() {
  const storeNodes = useRunStore((s) => s.nodes);
  const storeEdges = useRunStore((s) => s.edges);
  const selectedId = useRunStore((s) => s.selectedNodeId);
  const runId = useRunStore((s) => s.runId);

  // Compute layouted React Flow elements only when store changes
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => storeToFlowElements(storeNodes, storeEdges, selectedId),
    [storeNodes, storeEdges, selectedId]
  );

  const [nodes, , onNodesChange] = useNodesState(layoutedNodes);
  const [edges, , onEdgesChange] = useEdgesState(layoutedEdges);

  // Sync React Flow state when layout changes
  // (We drive positions externally via dagre so we use controlled nodes)
  const controlledNodes = layoutedNodes;
  const controlledEdges = layoutedEdges;

  if (!runId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Enter a run ID above to start visualising.
      </div>
    );
  }

  if (controlledNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Waiting for agent events…
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={controlledNodes}
      edges={controlledEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="#1F2937"
      />
      <Controls
        style={{
          background: "#1F2937",
          border: "1px solid #374151",
          borderRadius: 6,
        }}
      />
      <MiniMap
        nodeColor={(n) => {
          const status = (n.data as DagNodeData)?.status ?? "PENDING";
          const colors: Record<string, string> = {
            PENDING: "#6B7280",
            ACTIVE: "#FCD34D",
            SUCCESS: "#10B981",
            ALERT: "#EF4444",
          };
          return colors[status] ?? "#6B7280";
        }}
        style={{
          background: "#111827",
          border: "1px solid #374151",
        }}
      />
    </ReactFlow>
  );
}
