# Agent Debugger & Trajectory Visualizer

Real-time observability dashboard for LangGraph multi-agent pipelines. Captures agent reasoning, tool calls, state deltas, critic scores, token usage, and dollar cost as they happen — and visualizes them as a live DAG, flame graph, state inspector, and cost tracker.

---

## Features

### Live Dashboard
- **DAG Canvas** — live node graph with status colours: pulsing yellow (active), green (success), red (error), pulsing sky-blue (interrupted/paused). Fan-in and fan-out edges are rendered correctly for any topology.
- **Event Log** — chronological stream of every trace event; click any row to jump to that node's state.
- **State Inspector** — incremental RFC 6902 JSON diff of agent state at the selected node, with collapsible keys and inline `more/less` for long values. Also shows per-node token breakdown (prompt / completion), estimated dollar cost, and model name.
- **Critic Panel** — async LLM alignment scores (0.0 – 1.0) and divergence flags per node, computed in the background without blocking the agent.
- **Flame Graph** — node execution time (bar width) and token heat (bar colour) across the full run timeline.
- **Recent Runs dropdown** — instantly reconnect to any run stored in Redis (last 24 h).
- **Run cost badge** — header shows a live running total (`7n / 77e · $0.043`) of estimated LLM spend across all nodes the moment they complete.

### Token & Cost Tracking
Every node that calls an LLM shows:
- **Token breakdown** — `500↑597↓` (prompt tokens up, completion tokens down)
- **Dollar cost badge** — `≈ $0.0087 · GPT-4o` colour-coded by magnitude (emerald → teal → yellow → orange → red)
- **Tooltip** — full breakdown on hover: model name, prompt tokens, completion tokens, estimated cost

Costs are calculated from a built-in pricing table covering all major providers:

| Provider | Models |
|---|---|
| **OpenAI** | o1, o3-mini, GPT-4o, GPT-4o mini, GPT-4 Turbo, GPT-4, GPT-3.5 Turbo |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku |
| **Google** | Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 1.5 Pro, Gemini 1.5 Flash |

Model names are matched by substring — versioned names like `gpt-4o-2024-08-06` resolve automatically.

### Human-in-the-Loop: Interrupt & Edit State
LangGraph's `interrupt_before` mechanism is fully wired into the UI:

1. In the **Pipeline Builder**, toggle the **⏸ button** on any node to mark it "pause before".
2. When the run reaches that node, execution freezes and the node turns **sky-blue** in the DAG.
3. An **Interrupt Banner** slides up from the bottom of the canvas showing the live agent state.
4. Two actions:
   - **▶ Approve & Continue** — resumes without changes
   - **✎ Edit & Resume** — opens textareas for each state field; submit a patch and LangGraph applies it via `graph.update_state()` before resuming
5. Append-only fields (`fact_check_notes`, `domain_notes`) are labelled **→ appends** so you know edits will concatenate rather than replace.

Runs time out after 10 minutes if no action is taken.

### Pipeline Builder
A no-code visual canvas for assembling your own agent pipelines without writing Python:

1. Go to **[Builder](http://localhost:3000/builder)** from the home page.
2. Click components from the left palette to drop them on the canvas.
3. Drag handles to connect nodes in any topology (sequential, parallel, fan-in, fan-out).
4. Optionally toggle **⏸** on any node to pause execution before it runs.
5. Enter a research topic and click **Run →**.
6. The dashboard opens automatically and streams the execution in real time.
7. Click **⬡ Builder** in the dashboard header to return — your full pipeline (nodes, edges, positions, pause-before toggles, topic) is automatically restored.

The builder sends the full graph topology to the backend, so every edge you draw — including multiple parents feeding into one node — appears correctly in the DAG.

### Canvas Persistence
The Pipeline Builder auto-saves all canvas state (nodes, edges, topic, pause-before toggles) to `localStorage`. Navigating back via the dashboard's **Builder** link restores everything exactly. Opening the Builder page fresh always starts with an empty canvas. The **✕ Clear** button wipes saved state.

### Built-in Component Library

Nine ready-made research pipeline components, each backed by real APIs (no mocks):

| Component | Colour | Tools used | Writes |
|---|---|---|---|
| **Research Planner** | Indigo | — | `messages` |
| **Fact Checker** | Blue | DuckDuckGo, Wikipedia REST, arXiv | `fact_check_notes` |
| **Domain Expert** | Violet | arXiv XML, Wikipedia REST, DuckDuckGo | `domain_notes` |
| **Aggregator** | Amber | — | `aggregated_draft` |
| **Web Researcher** | Cyan | DuckDuckGo, Wikipedia REST, arXiv | `fact_check_notes` |
| **Summarizer** | Teal | — | `aggregated_draft` |
| **Critic Review** | Orange | — | `critic_verdict` |
| **Reviser** | Rose | — | `aggregated_draft`, `revision_notes` |
| **Finalizer** | Emerald | — | `final_answer` |

Placing `critic_review` followed by `revise` and `finalize` automatically enables conditional routing — the graph loops back to `revise` once if the critic requests it, then routes to `finalize`.

Parallel nodes (e.g. `fact_checker` + `domain_expert` + `web_researcher` all running at once) are fully supported; their writes are merged by state reducers rather than overwriting each other.

### Probe — instrument any LangGraph agent

Drop the probe into any existing LangGraph agent with two lines:

```python
from instrumentation import AgentProbe

probe = AgentProbe(run_id="my-run-001")
result = your_graph.invoke(inputs, config={"callbacks": [probe]})
probe.flush()  # wait for all Redis writes to land
```

The probe captures:
- `CHAIN_START` / `CHAIN_END` — DAG node lifecycle + state diffs
- `LLM_START` / `LLM_END` — token usage (prompt, completion, total), model name, latency, and internal monologue
- `TOOL_CALL` / `TOOL_RESULT` — every tool invocation with inputs, outputs, and latency
- `INTERRUPT` — emitted when a run pauses at an `interrupt_before` node, including a snapshot of the current state
- Retry / cycle detection — revisited nodes appear as `node_id#iter1`, `#iter2`, … with loopback edges

---

## Architecture

```
Your LangGraph Agent  (or Pipeline Builder)
      │
      ▼
instrumentation/   ← Python probe (non-blocking callbacks)
      │  emits TraceEvents → Redis Stream + Pub/Sub
      ▼
backend/           ← FastAPI + WebSockets
      │  run_manager: threads + resume events for interrupt/resume
      │  interrupt API: GET interrupt-state, POST resume
      │  stores run topology for builder runs
      ▼
frontend/          ← Next.js 14
      │  DAG, Flame Graph, State Inspector, Critic, InterruptBanner
      │  pricing.ts: token → dollar cost (14 models across 3 providers)
      └  useRunStore (Zustand + Immer): live state + interrupt info
```

---

## Prerequisites

- Python 3.11+
- Node.js 20+
- A Redis instance (see below)
- An OpenAI API key (needed for LLM nodes and optional Critic scoring)

---

## 1. Redis

**Homebrew (local)**
```bash
brew install redis
brew services start redis
# default URL: redis://localhost:6379
```

**Upstash (free hosted)**
Sign up at [upstash.com](https://upstash.com), create a database, copy the `rediss://...` connection string.

---

## 2. Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
REDIS_URL=redis://localhost:6379        # or your Upstash URL
OPENAI_API_KEY=sk-...                   # required for agent nodes + Critic scoring
```

---

## 3. Backend

```bash
# From the repo root
python -m venv venv
source venv/bin/activate

pip install -e .

uvicorn backend.main:app --reload
# → http://localhost:8000
```

---

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

---

## 5. Quick start — built-in example agent

```bash
# From the repo root, with venv active
PYTHONPATH=. python -m instrumentation.example_agent
```

Output:
```
Starting run  : run-3f8a1c2b
Question      : What are the latest breakthroughs in quantum computing?
Dashboard URL : http://localhost:3000/dashboard?run=run-3f8a1c2b
```

Open the URL — the DAG populates in real time.

---

## 6. Quick start — Pipeline Builder

1. Open [http://localhost:3000](http://localhost:3000)
2. Click **Build your own ⬡** (or **⬡ Builder** in the dashboard header)
3. Click components from the palette to add them to the canvas
4. Connect them by dragging from a node's bottom handle to another node's top handle
5. Optionally click **⏸** on a node to pause before it runs
6. Type a topic and click **Run →**

After the run completes, click **⬡ Builder** in the header to return with your pipeline fully restored.

---

## 7. Using the probe in your own agent

```python
import uuid
from instrumentation import AgentProbe

run_id = f"run-{uuid.uuid4().hex[:8]}"
print(f"Dashboard: http://localhost:3000/dashboard?run={run_id}")

probe = AgentProbe(run_id=run_id)

result = your_graph.invoke(
    your_inputs,
    config={"callbacks": [probe]},
)
probe.flush()
```

---

## REST API

```bash
# List all runs
curl http://localhost:8000/api/runs

# Replay events for a run
curl http://localhost:8000/api/runs/{run_id}/events

# Get current materialised state
curl http://localhost:8000/api/runs/{run_id}/state

# Delete a run
curl -X DELETE http://localhost:8000/api/runs/{run_id}

# Component registry (for the builder UI)
curl http://localhost:8000/api/components

# Start a pipeline-builder run programmatically
curl -X POST http://localhost:8000/api/build \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Quantum computing breakthroughs",
    "nodes": [
      {"id": "planner",       "type": "planner"},
      {"id": "web_researcher","type": "web_researcher"},
      {"id": "aggregator",    "type": "aggregator"},
      {"id": "finalize",      "type": "finalize"}
    ],
    "edges": [
      {"source": "planner",        "target": "web_researcher"},
      {"source": "web_researcher", "target": "aggregator"},
      {"source": "aggregator",     "target": "finalize"}
    ],
    "interrupt_before": ["aggregator"]
  }'

# Check interrupt state (when a run is paused)
curl http://localhost:8000/api/runs/{run_id}/interrupt-state

# Resume a paused run — approve unchanged
curl -X POST http://localhost:8000/api/runs/{run_id}/resume \
  -H "Content-Type: application/json" \
  -d '{"action": "approve"}'

# Resume a paused run — edit state first
curl -X POST http://localhost:8000/api/runs/{run_id}/resume \
  -H "Content-Type: application/json" \
  -d '{"action": "edit", "state_patch": {"aggregated_draft": "My revised draft..."}}'
```

---

## Dashboard at a glance

| Panel | What it shows |
|---|---|
| **DAG Canvas** | Live node graph — gray (pending), pulsing yellow (active), green (success), red (error), pulsing sky-blue (interrupted) |
| **Event Log** | Chronological stream of every TraceEvent; click any row to select that node |
| **State Inspector** | RFC 6902 JSON diff — what changed in agent state at the selected node; plus token breakdown, estimated cost, and model name |
| **Critic** | LLM alignment scores (0–1) and divergence flags per node |
| **Flame Graph** | Node latency (width) and token heat (colour) across the full run timeline |
| **Interrupt Banner** | Slides up when a run is paused — shows live state, Approve & Continue or Edit & Resume buttons |

---

## Docker (all-in-one)

```bash
cp .env.example .env   # add OPENAI_API_KEY
docker-compose up --build
```

Services: Redis on `6379`, backend on `8000`, frontend on `3000`.

