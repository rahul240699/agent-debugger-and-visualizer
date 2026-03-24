import type { Metadata } from "next";
import Link from "next/link";
import BuilderCanvas from "@/components/BuilderCanvas";

export const metadata: Metadata = {
  title: "Pipeline Builder — Agent Debugger",
  description: "Visually compose your own LangGraph pipeline and watch it run live.",
};

export default function BuilderPage() {
  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Header */}
      <header className="relative z-10 flex items-center gap-4 px-5 py-2.5 bg-gray-900 border-b border-gray-800/80 shrink-0">
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-[10px] font-bold select-none group-hover:opacity-90 transition-opacity">
            A
          </div>
          <span className="hidden sm:block text-sm font-semibold text-gray-100 group-hover:text-white transition-colors tracking-tight">
            Agent Debugger
          </span>
        </Link>

        <div className="w-px h-5 bg-gray-800 shrink-0" />

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200 tracking-tight">
            Pipeline Builder
          </span>
          <span className="text-[9px] bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 rounded px-1.5 py-0.5 font-mono">
            beta
          </span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-4 text-[11px] text-gray-600">
          <span>Drag handles between nodes to connect them</span>
          <span>·</span>
          <span>Backspace to delete selected</span>
        </div>

        <Link
          href="/dashboard"
          className="text-xs text-gray-500 hover:text-gray-300 transition shrink-0"
        >
          Dashboard →
        </Link>
      </header>

      {/* Canvas fills the rest */}
      <div className="flex-1 min-h-0">
        <BuilderCanvas />
      </div>
    </div>
  );
}
