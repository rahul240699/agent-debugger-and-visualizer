"use client";

/**
 * DagNode — custom React Flow node component.
 *
 * Visual states
 * -------------
 *  PENDING → gray    (#6B7280)  no animation
 *  ACTIVE  → yellow  (#FCD34D)  CSS pulse ring
 *  SUCCESS → green   (#10B981)  no animation
 *  ALERT   → red     (#EF4444)  CSS shake
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useRunStore, type DagNodeData } from "@/store/useRunStore";

const STATUS_STYLE: Record<
  string,
  { border: string; bg: string; text: string; animation: string }
> = {
  PENDING: {
    border: "border-gray-500",
    bg: "bg-gray-800",
    text: "text-gray-300",
    animation: "",
  },
  ACTIVE: {
    border: "border-yellow-400",
    bg: "bg-yellow-900/30",
    text: "text-yellow-300",
    animation: "node-active",
  },
  SUCCESS: {
    border: "border-emerald-500",
    bg: "bg-emerald-900/20",
    text: "text-emerald-300",
    animation: "",
  },
  ALERT: {
    border: "border-red-500",
    bg: "bg-red-900/20",
    text: "text-red-300",
    animation: "node-alert",
  },
};

const STATUS_DOT: Record<string, string> = {
  PENDING: "bg-gray-500",
  ACTIVE: "bg-yellow-400",
  SUCCESS: "bg-emerald-500",
  ALERT: "bg-red-500",
};

type DagNodeProps = NodeProps & {
  data: DagNodeData & { selected?: boolean };
};

export const DagNodeComponent = memo(function DagNodeComponent({
  data,
  selected,
}: DagNodeProps) {
  const selectNode = useRunStore((s) => s.selectNode);
  const style = STATUS_STYLE[data.status] ?? STATUS_STYLE.PENDING;

  const totalTokens =
    (data.telemetry.prompt_tokens ?? 0) +
    (data.telemetry.completion_tokens ?? 0);
  const latency = data.telemetry.latency_ms;

  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        onClick={() => selectNode(data.id)}
        className={`
          relative px-3 py-2 rounded-lg border cursor-pointer select-none transition-all
          min-w-[160px] max-w-[220px]
          ${style.border} ${style.bg} ${style.animation}
          ${selected ? "ring-2 ring-indigo-400 ring-offset-1 ring-offset-gray-950" : ""}
        `}
      >
        {/* Status dot + label */}
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[data.status]}`}
          />
          <span
            className={`font-mono text-xs font-semibold truncate ${style.text}`}
          >
            {data.label}
          </span>
          {data.iteration > 0 && (
            <span className="ml-auto text-[9px] bg-gray-700 text-gray-300 rounded px-1">
              ×{data.iteration + 1}
            </span>
          )}
        </div>

        {/* Telemetry micro-bar */}
        {(totalTokens > 0 || latency !== undefined) && (
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-gray-400">
            {latency !== undefined && (
              <span title="Latency">{latency}ms</span>
            )}
            {totalTokens > 0 && (
              <span title="Total tokens" className="text-indigo-400">
                {totalTokens}tok
              </span>
            )}
          </div>
        )}

        {/* Critic alignment score badge */}
        {data.critic?.alignment_score !== undefined && (
          <div
            className={`mt-1 text-[10px] px-1 rounded text-center font-mono
              ${
                data.critic.alignment_score >= 0.8
                  ? "bg-emerald-800 text-emerald-300"
                  : data.critic.alignment_score >= 0.5
                    ? "bg-yellow-800 text-yellow-300"
                    : "bg-red-800 text-red-300"
              }
              ${data.critic.divergence_flag ? "ring-1 ring-red-400" : ""}
            `}
            title={data.critic.reasoning ?? "Critic score"}
          >
            ★ {data.critic.alignment_score.toFixed(2)}
            {data.critic.divergence_flag && " ⚠"}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
});
