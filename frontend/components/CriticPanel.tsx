"use client";

import { useMemo, useState } from "react";
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

function CriticModal({
  node,
  onClose,
}: {
  node: DagNodeData;
  onClose: () => void;
}) {
  const score = node.critic?.alignment_score ?? 0;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div>
            <span className="font-mono text-indigo-300 text-sm">{node.label}</span>
            {node.critic?.divergence_flag && (
              <span className="ml-2 text-[10px] bg-red-800 text-red-300 rounded px-1.5 py-0.5">
                ⚠ DIVERGED
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Score bar */}
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-400">Alignment Score</span>
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
            <span className="font-mono text-sm font-bold" style={{ color }}>
              {pct}%
            </span>
          </div>
        </div>

        {/* Full reasoning */}
        <div className="flex-1 overflow-auto px-4 py-3">
          <p className="text-[11px] text-gray-400 mb-1 uppercase tracking-wider">Critic Review</p>
          <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
            {node.critic?.reasoning ?? "No reasoning provided."}
          </p>
        </div>
      </div>
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
  const [modalNode, setModalNode] = useState<DagNodeData | null>(null);

  const scoredNodes = useMemo<ScoredNode[]>(() => {
    return Object.values(nodes)
      .filter((n) => n.critic?.alignment_score !== undefined)
      .map((n) => ({ node: n, score: n.critic!.alignment_score! }))
      .sort((a, b) => a.score - b.score);
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
    <>
      {modalNode && (
        <CriticModal node={modalNode} onClose={() => setModalNode(null)} />
      )}

      <div className="flex flex-col h-full overflow-auto px-3 py-2 gap-2">
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
            onClick={() => {
              selectNode(node.id);
              setModalNode(node);
            }}
            className={`
              rounded-lg border p-2.5 cursor-pointer transition
              ${
                selectedId === node.id
                  ? "border-indigo-500 bg-indigo-900/20"
                  : "border-gray-700 bg-gray-800/40 hover:border-gray-600"
              }
            `}
          >
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

            <AlignmentGauge score={score} />

            {node.critic?.reasoning && (
              <p className="mt-1.5 text-[10px] text-gray-400 line-clamp-2">
                {node.critic.reasoning}
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
