"use client";

/**
 * FlameGraph — D3-powered SVG flame chart showing per-node execution time
 * and token usage heat.
 *
 * X-axis: wall-clock time (ms) relative to run start.
 * Bar width: proportional to latency_ms.
 * Bar colour: blue (low tokens) → orange → red (high tokens).
 */

import { useMemo, useRef } from "react";
import * as d3 from "d3";
import { useRunStore, type DagNodeData } from "@/store/useRunStore";

interface FlameBar {
  id: string;
  label: string;
  x: number;       // start time offset (ms)
  width: number;   // latency (ms)
  tokens: number;
}

const HEIGHT = 32;
const LABEL_MAX = 14;
const PADDING = { top: 24, bottom: 20, left: 8, right: 8 };

export default function FlameGraph() {
  const nodes = useRunStore((s) => s.nodes);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build bar data from nodes that have timing information
  const bars = useMemo<FlameBar[]>(() => {
    const items: FlameBar[] = [];
    let minStart = Infinity;

    for (const n of Object.values(nodes)) {
      const start = n.timestampStart;
      if (start != null && start < minStart) minStart = start;
    }

    for (const n of Object.values(nodes)) {
      const start = n.timestampStart;
      const latency = n.telemetry.latency_ms ?? 0;
      if (start == null || latency === 0) continue;

      items.push({
        id: n.id,
        label: n.label,
        x: start - minStart,
        width: latency,
        tokens:
          (n.telemetry.prompt_tokens ?? 0) +
          (n.telemetry.completion_tokens ?? 0),
      });
    }

    return items.sort((a, b) => a.x - b.x);
  }, [nodes]);

  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs">
        Flame graph — timing data appears after nodes complete.
      </div>
    );
  }

  const maxX = Math.max(...bars.map((b) => b.x + b.width));
  const maxTokens = Math.max(...bars.map((b) => b.tokens), 1);

  const colourScale = d3
    .scaleSequential(d3.interpolateRgb("#3B82F6", "#EF4444"))
    .domain([0, maxTokens]);

  return (
    <div ref={containerRef} className="h-full w-full overflow-x-auto px-2">
      <p className="text-[10px] text-gray-500 pt-1 pb-0.5">
        Flame Graph — node latency (width) & token heat (colour)
      </p>
      <svg
        width="100%"
        height={HEIGHT + PADDING.top + PADDING.bottom}
        viewBox={`0 0 1200 ${HEIGHT + PADDING.top + PADDING.bottom}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {/* Time axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const xPx = PADDING.left + t * (1200 - PADDING.left - PADDING.right);
          const ms = Math.round(t * maxX);
          return (
            <text
              key={t}
              x={xPx}
              y={PADDING.top - 6}
              fontSize={9}
              fill="#6B7280"
              textAnchor="middle"
            >
              {ms}ms
            </text>
          );
        })}

        {bars.map((bar) => {
          const xScale = (1200 - PADDING.left - PADDING.right) / maxX;
          const rx = PADDING.left + bar.x * xScale;
          const rw = Math.max(bar.width * xScale, 2);
          const fill = bar.tokens > 0 ? colourScale(bar.tokens) : "#4B5563";

          return (
            <g key={bar.id}>
              <rect
                x={rx}
                y={PADDING.top}
                width={rw}
                height={HEIGHT}
                fill={fill}
                opacity={0.85}
                rx={3}
              >
                <title>
                  {bar.label}: {bar.width}ms, {bar.tokens} tokens
                </title>
              </rect>
              {rw > 40 && (
                <text
                  x={rx + 4}
                  y={PADDING.top + HEIGHT / 2 + 4}
                  fontSize={10}
                  fill="#fff"
                  style={{ pointerEvents: "none" }}
                >
                  {bar.label.length > LABEL_MAX
                    ? bar.label.slice(0, LABEL_MAX) + "…"
                    : bar.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
