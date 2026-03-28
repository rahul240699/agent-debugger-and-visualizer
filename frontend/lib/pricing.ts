/**
 * LLM pricing table — cost per 1 million tokens (USD).
 *
 * Sources (March 2026):
 *   OpenAI   — https://openai.com/api/pricing
 *   Anthropic — https://www.anthropic.com/pricing
 *   Google   — https://ai.google.dev/pricing
 *
 * Entries are matched by substring against the model_name field that
 * LangChain/LangGraph puts in telemetry, so "gpt-4o-2024-08-06" will
 * correctly match the "gpt-4o" entry.  More-specific prefixes are
 * listed first so they win over shorter ones.
 */

interface ModelPrice {
  label: string;        // display name shown in the UI
  inputPer1M: number;   // USD per 1 million prompt tokens
  outputPer1M: number;  // USD per 1 million completion tokens
}

// Ordered longest-prefix-first so substring matching is greedy
const PRICE_TABLE: [string, ModelPrice][] = [
  // ── OpenAI ──────────────────────────────────────────────────────────────
  ["o1-mini",       { label: "o1-mini",       inputPer1M:  3.00, outputPer1M:  12.00 }],
  ["o3-mini",       { label: "o3-mini",       inputPer1M:  1.10, outputPer1M:   4.40 }],
  ["o1",            { label: "o1",            inputPer1M: 15.00, outputPer1M:  60.00 }],
  ["gpt-4o-mini",   { label: "GPT-4o mini",   inputPer1M:  0.15, outputPer1M:   0.60 }],
  ["gpt-4o",        { label: "GPT-4o",        inputPer1M:  2.50, outputPer1M:  10.00 }],
  ["gpt-4-turbo",   { label: "GPT-4 Turbo",   inputPer1M: 10.00, outputPer1M:  30.00 }],
  ["gpt-4",         { label: "GPT-4",         inputPer1M: 30.00, outputPer1M:  60.00 }],
  ["gpt-3.5-turbo", { label: "GPT-3.5 Turbo", inputPer1M:  0.50, outputPer1M:   1.50 }],

  // ── Anthropic ───────────────────────────────────────────────────────────
  ["claude-3-5-sonnet", { label: "Claude 3.5 Sonnet", inputPer1M:  3.00, outputPer1M:  15.00 }],
  ["claude-3-5-haiku",  { label: "Claude 3.5 Haiku",  inputPer1M:  0.80, outputPer1M:   4.00 }],
  ["claude-3-opus",     { label: "Claude 3 Opus",     inputPer1M: 15.00, outputPer1M:  75.00 }],
  ["claude-3-sonnet",   { label: "Claude 3 Sonnet",   inputPer1M:  3.00, outputPer1M:  15.00 }],
  ["claude-3-haiku",    { label: "Claude 3 Haiku",    inputPer1M:  0.25, outputPer1M:   1.25 }],

  // ── Google ──────────────────────────────────────────────────────────────
  ["gemini-2.0-flash-lite", { label: "Gemini 2.0 Flash Lite", inputPer1M: 0.075, outputPer1M: 0.30 }],
  ["gemini-2.0-flash",      { label: "Gemini 2.0 Flash",      inputPer1M: 0.10,  outputPer1M: 0.40 }],
  ["gemini-1.5-flash",      { label: "Gemini 1.5 Flash",      inputPer1M: 0.075, outputPer1M: 0.30 }],
  ["gemini-1.5-pro",        { label: "Gemini 1.5 Pro",        inputPer1M: 1.25,  outputPer1M: 5.00 }],
];

export function lookupModel(modelName?: string): ModelPrice | null {
  if (!modelName) return null;
  const lower = modelName.toLowerCase();
  for (const [prefix, price] of PRICE_TABLE) {
    if (lower.includes(prefix)) return price;
  }
  return null;
}

/**
 * Estimate cost in USD.
 * Returns null if the model is unknown or no token data is present.
 */
export function calcCost(
  promptTokens: number | undefined,
  completionTokens: number | undefined,
  modelName: string | undefined
): number | null {
  const price = lookupModel(modelName);
  if (!price) return null;
  const inp = promptTokens ?? 0;
  const out = completionTokens ?? 0;
  if (inp === 0 && out === 0) return null;
  return (inp * price.inputPer1M + out * price.outputPer1M) / 1_000_000;
}

/**
 * Format a USD cost for display.
 * < $0.0001  → "<$0.0001"
 * < $0.01    → "$0.0000" (4 decimal places — micro costs)
 * < $1       → "$0.0000" (4 decimal places)
 * ≥ $1       → "$0.00"   (2 decimal places)
 */
export function formatCost(usd: number): string {
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 1)      return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Tailwind colour class based on cost magnitude */
export function costColor(usd: number): string {
  if (usd < 0.001)  return "text-emerald-400";
  if (usd < 0.01)   return "text-teal-300";
  if (usd < 0.05)   return "text-yellow-400";
  if (usd < 0.20)   return "text-orange-400";
  return "text-red-400";
}
