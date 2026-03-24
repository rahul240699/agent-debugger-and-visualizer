"use client";

/**
 * BuilderNode — custom React Flow node for the visual pipeline builder.
 *
 * Larger and more informative than the dashboard DagNode:
 *  • colour-coded gradient border per component type
 *  • shows description, reads/writes badges, tool chips
 *  • ✕ delete button in the corner
 */

import { memo } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";

export interface BuilderNodeData {
  componentKey: string;
  label: string;
  description: string;
  color: string;
  reads: string[];
  writes: string[];
  tools: string[];
  instanceIndex: number;
  [key: string]: unknown; // React Flow requires index signature
}

// Tailwind can't generate arbitrary class names at runtime — list all combos:
const COLOR: Record<
  string,
  { border: string; bg: string; text: string; badge: string; dot: string }
> = {
  indigo:  { border: "border-indigo-500/60",  bg: "bg-indigo-950/50",  text: "text-indigo-300",  badge: "bg-indigo-900/60 text-indigo-300",  dot: "bg-indigo-500"  },
  blue:    { border: "border-blue-500/60",     bg: "bg-blue-950/50",    text: "text-blue-300",    badge: "bg-blue-900/60 text-blue-300",      dot: "bg-blue-500"    },
  violet:  { border: "border-violet-500/60",   bg: "bg-violet-950/50",  text: "text-violet-300",  badge: "bg-violet-900/60 text-violet-300",  dot: "bg-violet-500"  },
  amber:   { border: "border-amber-500/60",    bg: "bg-amber-950/50",   text: "text-amber-300",   badge: "bg-amber-900/60 text-amber-300",    dot: "bg-amber-500"   },
  cyan:    { border: "border-cyan-500/60",     bg: "bg-cyan-950/50",    text: "text-cyan-300",    badge: "bg-cyan-900/60 text-cyan-300",      dot: "bg-cyan-500"    },
  teal:    { border: "border-teal-500/60",     bg: "bg-teal-950/50",    text: "text-teal-300",    badge: "bg-teal-900/60 text-teal-300",      dot: "bg-teal-500"    },
  orange:  { border: "border-orange-500/60",   bg: "bg-orange-950/50",  text: "text-orange-300",  badge: "bg-orange-900/60 text-orange-300",  dot: "bg-orange-500"  },
  rose:    { border: "border-rose-500/60",     bg: "bg-rose-950/50",    text: "text-rose-300",    badge: "bg-rose-900/60 text-rose-300",      dot: "bg-rose-500"    },
  emerald: { border: "border-emerald-500/60",  bg: "bg-emerald-950/50", text: "text-emerald-300", badge: "bg-emerald-900/60 text-emerald-300",dot: "bg-emerald-500" },
};

const FALLBACK = COLOR.indigo;

type Props = NodeProps & { data: BuilderNodeData };

export const BuilderNodeComponent = memo(function BuilderNodeComponent({
  id,
  data,
  selected,
}: Props) {
  const { deleteElements } = useReactFlow();
  const c = COLOR[data.color] ?? FALLBACK;

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-gray-600 !border-2 !border-gray-800 hover:!bg-indigo-400 transition-colors"
      />

      <div
        className={`
          relative rounded-xl border-2 cursor-default select-none transition-all w-52
          ${c.border} ${c.bg}
          ${selected ? "ring-2 ring-white/30 ring-offset-1 ring-offset-gray-950 shadow-lg" : "shadow-md"}
        `}
      >
        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteElements({ nodes: [{ id }] });
          }}
          className="absolute top-1.5 right-1.5 w-4 h-4 flex items-center justify-center
            text-gray-600 hover:text-gray-200 hover:bg-gray-700/60 rounded transition-colors
            text-[10px] leading-none z-10"
          title="Remove node"
        >
          ✕
        </button>

        <div className="px-3 pt-3 pb-2.5">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2 pr-4">
            <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
            <span className={`text-xs font-semibold leading-tight ${c.text}`}>
              {data.label}
            </span>
            {data.instanceIndex > 0 && (
              <span className="text-[9px] text-gray-600 ml-auto">
                #{data.instanceIndex + 1}
              </span>
            )}
          </div>

          {/* Description */}
          <p className="text-[10px] text-gray-500 leading-relaxed mb-2.5">
            {data.description}
          </p>

          {/* Reads / writes */}
          <div className="flex flex-col gap-1 mb-2">
            {data.reads.length > 0 && (
              <div className="flex items-start gap-1 flex-wrap">
                <span className="text-[9px] text-gray-600 shrink-0 mt-0.5 w-9">reads</span>
                {data.reads.map((k) => (
                  <span
                    key={k}
                    className="text-[9px] bg-gray-800/80 text-gray-400 rounded px-1 py-0.5 font-mono"
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
            {data.writes.length > 0 && (
              <div className="flex items-start gap-1 flex-wrap">
                <span className="text-[9px] text-gray-600 shrink-0 mt-0.5 w-9">writes</span>
                {data.writes.map((k) => (
                  <span
                    key={k}
                    className={`text-[9px] rounded px-1 py-0.5 font-mono ${c.badge}`}
                  >
                    {k}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Tools */}
          {data.tools.length > 0 && (
            <div className="flex flex-wrap gap-1 border-t border-gray-800/60 pt-2">
              {data.tools.map((t) => (
                <span
                  key={t}
                  className="text-[9px] bg-gray-800/60 text-gray-500 rounded px-1 py-0.5 font-mono"
                >
                  🔧 {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-gray-600 !border-2 !border-gray-800 hover:!bg-indigo-400 transition-colors"
      />
    </>
  );
});
