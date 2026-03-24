"use client";

/**
 * EventLog — virtualized chronological list of TraceEvents.
 * Uses react-window FixedSizeList for performance under high-frequency updates.
 */

import { memo } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { useRunStore } from "@/store/useRunStore";
import type { TraceEvent } from "@/lib/schema";

const STATUS_COLOR: Record<string, string> = {
  PENDING: "text-gray-500",
  ACTIVE: "text-yellow-400",
  SUCCESS: "text-emerald-400",
  ALERT: "text-red-400",
};

const EVENT_ICON: Record<string, string> = {
  CHAIN_START: "▶",
  CHAIN_END: "■",
  LLM_START: "⚙",
  LLM_END: "✓",
  TOOL_CALL: "🔧",
  TOOL_RESULT: "↩",
  STATE_DELTA: "Δ",
  CRITIC_SCORE: "★",
  HYDRATE: "⇓",
};

const EventRow = memo(function EventRow({
  index,
  style,
  data,
}: ListChildComponentProps<TraceEvent[]>) {
  const event = data[index];
  const selectNode = useRunStore((s) => s.selectNode);
  const selectedId = useRunStore((s) => s.selectedNodeId);

  const isSelected = selectedId === event.node_id;
  const icon  = EVENT_ICON[event.event_type] ?? "•";
  const statusCls = STATUS_COLOR[event.status] ?? "text-gray-400";
  const ts = new Date(event.timestamp_ms).toISOString().slice(11, 19);

  return (
    <div
      style={style}
      onClick={() => selectNode(event.node_id)}
      className={`
        flex items-start gap-2 px-3 py-1.5 cursor-pointer
        border-b border-gray-800/40 hover:bg-gray-800/50 transition-colors
        ${isSelected ? "bg-indigo-950/50 border-l-2 border-l-indigo-500" : "border-l-2 border-l-transparent"}
      `}
    >
      <span className={`text-[11px] shrink-0 mt-[3px] ${statusCls}`}>{icon}</span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-1 mb-0.5">
          <span className={`font-mono text-[10px] font-medium truncate ${isSelected ? "text-indigo-300" : "text-gray-300"}`}>
            {event.node_id}
          </span>
          {event.iteration > 0 && (
            <span className="text-[9px] bg-gray-700/80 rounded px-0.5 text-gray-500 shrink-0">
              ×{event.iteration + 1}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-gray-600 font-mono tabular-nums">{ts}</span>
          <span className={`text-[10px] font-medium ${statusCls}`}>{event.event_type}</span>
          {event.payload.telemetry?.latency_ms != null && (
            <span className="text-[10px] text-gray-600">
              {event.payload.telemetry.latency_ms}ms
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

export default function EventLog() {
  const events = useRunStore((s) => s.events);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800/80 shrink-0 bg-gray-900">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
            Events
          </span>
          {events.length > 0 && (
            <span className="text-[10px] text-gray-600 tabular-nums">{events.length}</span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-700 text-xs">
            No events yet.
          </div>
        ) : (
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <FixedSizeList
                height={height}
                width={width}
                itemCount={events.length}
                itemSize={48}
                itemData={events}
              >
                {EventRow}
              </FixedSizeList>
            )}
          </AutoSizer>
        )}
      </div>
    </div>
  );
}
