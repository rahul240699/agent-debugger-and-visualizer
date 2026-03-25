"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const EXAMPLES = [
  {
    title: "LLMs in Scientific Research",
    description: "Explore how large language models are accelerating discovery across biology, chemistry, and physics.",
    topic: "The impact of large language models on scientific research",
    icon: "🔬",
    color: "from-indigo-500/20 to-violet-500/20 border-indigo-500/30",
    tag: "AI · Research",
  },
  {
    title: "Solid-State Battery Tech",
    description: "Investigate the latest breakthroughs in solid-state batteries and their path to mass-market EVs.",
    topic: "Advances in solid-state battery technology",
    icon: "⚡",
    color: "from-emerald-500/20 to-teal-500/20 border-emerald-500/30",
    tag: "Energy · Hardware",
  },
  {
    title: "CRISPR in Medicine",
    description: "Analyse how CRISPR-Cas9 gene editing is reshaping treatment for inherited diseases and cancer.",
    topic: "CRISPR gene editing applications in medicine",
    icon: "🧬",
    color: "from-rose-500/20 to-pink-500/20 border-rose-500/30",
    tag: "Biotech · Medicine",
  },
  {
    title: "Quantum Computing Outlook",
    description: "Survey the state of quantum hardware, error correction, and when practical quantum advantage arrives.",
    topic: "The current state and future outlook of quantum computing",
    icon: "⚛️",
    color: "from-sky-500/20 to-blue-500/20 border-sky-500/30",
    tag: "Physics · Computing",
  },
  {
    title: "Climate Tech Startups",
    description: "Map the venture landscape funding carbon capture, green hydrogen, and next-gen solar companies.",
    topic: "The rise of climate tech startups and green energy investment",
    icon: "🌍",
    color: "from-green-500/20 to-lime-500/20 border-green-500/30",
    tag: "Climate · Startups",
  },
  {
    title: "AI Agents & Automation",
    description: "Examine how autonomous AI agents are changing software engineering, business ops, and daily work.",
    topic: "How autonomous AI agents are transforming knowledge work",
    icon: "🤖",
    color: "from-amber-500/20 to-orange-500/20 border-amber-500/30",
    tag: "Agents · Future of Work",
  },
];

export default function Home() {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeTopic = custom.trim() || selected || "";

  async function handleRun() {
    if (!activeTopic) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: activeTopic }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { run_id } = await res.json();
      router.push(`/dashboard?run=${run_id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start run");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-sm font-bold">
            A
          </div>
          <span className="font-semibold tracking-tight text-gray-100">Agent Debugger</span>
          <span className="text-[10px] bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 rounded px-1.5 py-0.5 font-mono">
            v0.1
          </span>
        </div>
        <a
          href="/dashboard"
          className="text-xs text-gray-500 hover:text-gray-300 transition"
        >
          Open dashboard →
        </a>
        <a
          href="/builder"
          className="text-xs bg-indigo-900/50 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/50 rounded-lg px-3 py-1.5 transition font-medium"
        >
          Build your own ⬡
        </a>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-16 flex flex-col gap-12">
        {/* Hero */}
        <div className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
            Watch your agents think<br />in real time.
          </h1>
          <p className="text-gray-400 text-lg max-w-xl leading-relaxed">
            Pick a topic below or write your own. A 7-node research pipeline will run live — watch every node light up, inspect state deltas, and see the critic score each step.
          </p>
        </div>

        {/* Example cards */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-4">
            Choose an example
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {EXAMPLES.map((ex) => {
              const isSelected = selected === ex.topic && !custom.trim();
              return (
                <button
                  key={ex.topic}
                  onClick={() => { setSelected(ex.topic); setCustom(""); }}
                  className={`
                    text-left rounded-xl border bg-gradient-to-br p-4 transition-all duration-150
                    ${ex.color}
                    ${isSelected
                      ? "ring-2 ring-indigo-500 ring-offset-1 ring-offset-gray-950 scale-[1.02]"
                      : "hover:scale-[1.01] hover:brightness-110"
                    }
                  `}
                >
                  <div className="text-2xl mb-2">{ex.icon}</div>
                  <div className="font-semibold text-sm text-gray-100 mb-1">{ex.title}</div>
                  <div className="text-[11px] text-gray-400 leading-relaxed mb-3">{ex.description}</div>
                  <span className="text-[9px] font-mono text-gray-500 border border-gray-700 rounded px-1.5 py-0.5">
                    {ex.tag}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom input + run */}
        <div className="space-y-3">
          <p className="text-xs text-gray-500 uppercase tracking-widest">
            Or enter your own topic
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={custom}
              onChange={(e) => { setCustom(e.target.value); setSelected(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleRun()}
              placeholder="e.g. The future of nuclear fusion energy"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
            />
            <button
              onClick={handleRun}
              disabled={!activeTopic || loading}
              className={`
                px-6 py-3 rounded-lg font-semibold text-sm transition-all
                ${activeTopic && !loading
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/40"
                  : "bg-gray-800 text-gray-600 cursor-not-allowed"
                }
              `}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
                  Starting…
                </span>
              ) : (
                "Run →"
              )}
            </button>
          </div>

          {activeTopic && !loading && (
            <p className="text-[11px] text-gray-600">
              Topic:{" "}
              <span className="text-gray-400 italic">{activeTopic}</span>
            </p>
          )}

          {error && (
            <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-800/40 rounded px-3 py-1.5">
              {error}
            </p>
          )}
        </div>

        {/* How it works */}
        <div className="border-t border-gray-800 pt-10 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { step: "01", heading: "Pipeline kicks off", body: "LangGraph builds a 7-node DAG: planner → fact_checker → domain_expert → aggregator → critic_review → finalize." },
            { step: "02", heading: "Live instrumentation", body: "Every node transition, LLM call, and tool invocation is captured and streamed to the dashboard via Redis pub/sub." },
            { step: "03", heading: "Debug in real time", body: "Inspect state deltas, tool calls, token usage, and per-node alignment scores from the Critic LLM as it evaluates." },
          ].map(({ step, heading, body }) => (
            <div key={step} className="space-y-2">
              <div className="text-[10px] font-mono text-indigo-400">{step}</div>
              <div className="font-semibold text-sm text-gray-200">{heading}</div>
              <div className="text-[11px] text-gray-500 leading-relaxed">{body}</div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-gray-800 px-8 py-4 text-center text-[11px] text-gray-700">
        Built with LangGraph · FastAPI · Next.js · Redis
      </footer>
    </div>
  );
}
