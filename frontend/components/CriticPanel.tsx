"use client";

/**
 * CriticPanel — shows per-node alignment scores and divergence flags
 * populated asynchronously by the Critic Worker.
 *
 * Nodes are sorted by alignment_score (worst first) so misaligned steps
 * are immediately visible.
 */

import { useMemo } from "react";
import { useRunStore, type DagNodeData } from "@/store/useRunStore";

function AlignmentGauge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span
        className="text-[11px] font-mono w-8 text-right"
        style={{ color }}
      >
        {pct}%
      </span>
    </div>
  );
}

interface ScoredNode {
  node: DagNodeData;
  score: number;
}

export default function CriticPanel() {
  const nodes = useRunStore((s) => s.nodes);
  const selectNode = useRunStore((s) => s.selectNode);
  const selectedId = useRunStore((s) => s.selectedNodeId);

  const scoredNodes = useMemo<ScoredNode[]>(() => {
    return Object.values(nodes)
      .filter((n) => n.critic?.alignment_score !== undefined)
      .map((n) => ({ node: n, score: n.critic!.alignment_score! }))
      .sort((a, b) => a.score - b.score); // worst first
  }, [nodes]);

  const unscoredCount = useMemo(
    () =>
      Object.values(nodes).filter((n) => n.critic?.alignment_score === undefined)
        .length,
    [nodes]
  );

  if (Object.keys(nodes).length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs p-4 text-center">
        Critic scores appear after nodes complete (requires OPENAI_API_KEY).
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto px-3 py-2 gap-2">
      {/* Summary */}
      <div className="text-[10px] text-gray-500 shrink-0">
        {scoredNodes.length} scored · {unscoredCount} pending critic evaluation
      </div>

      {scoredNodes.length === 0 && (
        <div className="text-xs text-gray-600 text-center mt-4">
          Waiting for critic scores…
        </div>
      )}

      {scoredNodes.map(({ node, score }) => (
        <div
          key={node.id}
          onClick={() => selectNode(node.id)}
          className={`
            rounded-lg border p-2.5 cursor-pointer transition
            ${
              selectedId === node.id
                ? "border-indigo-500 bg-indigo-900/20"
                : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
            }
          `}
        >
          {/* Node label + divergence badge */}
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono text-[11px] text-indigo-300 truncate max-w-[140px]">
              {node.label}
            </span>
            {node.critic?.divergence_flag && (
              <span
                className="text-[9px] bg-red-800 text-red-300 rounded px-1 shrink-0"
                title="Divergence detected"
              >
                ⚠ DIVERGED
              </span>
            )}
          </div>

          {/* Alignment gauge */}
          <AlignmentGauge score={score} />

          {/* Reasoning excerpt */}
          {node.critic?.reasoning && (
            <p className="mt-1.5 text-[10px] text-gray-400 line-clamp-2">
              {node.critic.reasoning}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
