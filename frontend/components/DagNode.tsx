"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useRunStore, type DagNodeData } from "@/store/useRunStore";
import { calcCost, formatCost, costColor, lookupModel } from "@/lib/pricing";

const STATUS_STYLE: Record<
  string,
  { border: string; bg: string; text: string; animation: string; glow: string }
> = {
  PENDING: {
    border: "border-gray-700",
    bg: "bg-gray-900",
    text: "text-gray-400",
    animation: "",
    glow: "",
  },
  ACTIVE: {
    border: "border-yellow-400/80",
    bg: "bg-yellow-950/40",
    text: "text-yellow-300",
    animation: "node-active",
    glow: "shadow-[0_0_16px_2px_rgba(250,204,21,0.2)]",
  },
  SUCCESS: {
    border: "border-emerald-600/70",
    bg: "bg-emerald-950/30",
    text: "text-emerald-300",
    animation: "",
    glow: "",
  },
  ALERT: {
    border: "border-red-500/70",
    bg: "bg-red-950/30",
    text: "text-red-300",
    animation: "node-alert",
    glow: "shadow-[0_0_16px_2px_rgba(239,68,68,0.18)]",
  },
  INTERRUPTED: {
    border: "border-sky-500/70",
    bg: "bg-sky-950/30",
    text: "text-sky-300",
    animation: "node-active",
    glow: "shadow-[0_0_16px_2px_rgba(56,189,248,0.2)]",
  },
};

const STATUS_DOT: Record<string, string> = {
  PENDING:     "bg-gray-600",
  ACTIVE:      "bg-yellow-400",
  SUCCESS:     "bg-emerald-500",
  ALERT:       "bg-red-500",
  INTERRUPTED: "bg-sky-400",
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

  const promptTokens     = data.telemetry.prompt_tokens ?? 0;
  const completionTokens = data.telemetry.completion_tokens ?? 0;
  const totalTokens      = promptTokens + completionTokens;
  const latency          = data.telemetry.latency_ms;
  const modelName        = data.telemetry.model_name;
  const cost             = calcCost(promptTokens, completionTokens, modelName);
  const modelLabel       = lookupModel(modelName)?.label ?? modelName;

  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        onClick={() => selectNode(data.id)}
        className={`
          relative px-3 py-2.5 rounded-xl border cursor-pointer select-none transition-all
          min-w-[160px] max-w-[220px]
          ${style.border} ${style.bg} ${style.animation} ${style.glow}
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

        {/* Telemetry bar */}
        {(totalTokens > 0 || latency !== undefined) && (
          <div
            className="mt-1.5 space-y-0.5"
            title={[
              modelLabel ? `Model: ${modelLabel}` : null,
              promptTokens     ? `Prompt:     ${promptTokens.toLocaleString()} tok` : null,
              completionTokens ? `Completion: ${completionTokens.toLocaleString()} tok` : null,
              totalTokens      ? `Total:      ${totalTokens.toLocaleString()} tok` : null,
              cost != null     ? `Est. cost:  ${formatCost(cost)}` : null,
            ].filter(Boolean).join("\n")}
          >
            {/* Row 1: latency + token breakdown */}
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              {latency !== undefined && (
                <span>{latency}ms</span>
              )}
              {totalTokens > 0 && (
                <span className="text-indigo-400 font-mono">
                  {promptTokens > 0 && completionTokens > 0
                    ? <>{promptTokens.toLocaleString()}<span className="text-gray-600">↑</span>{completionTokens.toLocaleString()}<span className="text-gray-600">↓</span></>
                    : <>{totalTokens.toLocaleString()} tok</>
                  }
                </span>
              )}
            </div>

            {/* Row 2: dollar cost badge */}
            {cost != null && (
              <div className={`flex items-center gap-1 font-mono text-[10px] font-semibold ${costColor(cost)}`}>
                <span>≈</span>
                <span>{formatCost(cost)}</span>
                {modelLabel && (
                  <span className="text-gray-600 font-normal text-[9px] truncate max-w-[90px]">
                    · {modelLabel}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Critic alignment score badge */}
        {data.critic?.alignment_score !== undefined && (
          <div
            className={`mt-1.5 text-[10px] px-1.5 py-0.5 rounded-md text-center font-mono font-medium
              ${
                data.critic.alignment_score >= 0.8
                  ? "bg-emerald-900/60 text-emerald-300 border border-emerald-700/40"
                  : data.critic.alignment_score >= 0.5
                    ? "bg-yellow-900/60 text-yellow-300 border border-yellow-700/40"
                    : "bg-red-900/60 text-red-300 border border-red-700/40"
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
