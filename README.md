# Agent Debugger & Trajectory Visualizer

Real-time observability dashboard for LangGraph multi-agent swarms. Captures agent reasoning, tool calls, and state deltas as they happen and visualizes them as a live Directed Acyclic Graph (DAG).

---

## Architecture

```
Your LangGraph Agent
      │
      ▼
instrumentation/   ← Python probe (non-blocking callbacks)
      │  emits TraceEvents via Redis Pub/Sub
      ▼
backend/           ← FastAPI + WebSockets (streams deltas to browser)
      │
      ▼
frontend/          ← Next.js dashboard (DAG, Flame Graph, State Inspector, Critic)
```

---

## Prerequisites

- Python 3.11+
- Node.js 20+
- A Redis instance (see below)
- An OpenAI API key (optional — only needed for Critic alignment scoring)

---

## 1. Redis

The easiest options:

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

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
REDIS_URL=redis://localhost:6379        # or your Upstash URL
OPENAI_API_KEY=sk-...                   # optional, enables Critic scoring
```

Everything else can stay as default.

---

## 3. Backend

```bash
# From the repo root
python -m venv venv
source venv/bin/activate

pip install -e .

uvicorn backend.main:app --reload
# → running on http://localhost:8000
```

---

## 4. Frontend

```bash
cd frontend
npm install
npm run dev
# → running on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) — you'll see the dashboard.

---

## 5. Running an Agent (and what is a Run ID?)

### What is a Run ID?

A **run ID** is a string you assign to identify one complete execution of your agent. It's how the dashboard knows which stream of events to display. Think of it like a trace ID — every event emitted by the probe is tagged with it, and the frontend subscribes to a WebSocket channel keyed on it.

There's no server that generates it — **you create it** when you attach the probe to your agent.

### Getting a Run ID — the built-in example

```bash
# From the repo root, with venv active
PYTHONPATH=. python -m instrumentation.example_agent
```

The terminal will print something like:

```
Starting run  : run-3f8a1c2b
Question      : What are the latest breakthroughs in quantum computing?
Dashboard URL : http://localhost:3000/dashboard?run=run-3f8a1c2b
```

Copy that `run-3f8a1c2b` value (or click the dashboard URL directly), paste it into the **Run ID** input box in the UI, and click **Connect**. The DAG will start populating in real-time as the agent runs.

### Using the probe in your own LangGraph agent

```python
import uuid
from instrumentation import AgentProbe

# 1. Create a unique run ID for this invocation
run_id = f"run-{uuid.uuid4().hex[:8]}"
print(f"Dashboard: http://localhost:3000/dashboard?run={run_id}")

# 2. Attach the probe as a LangGraph callback
probe = AgentProbe(run_id=run_id)

result = your_graph.invoke(
    your_inputs,
    config={"callbacks": [probe]},
)
```

That's it. The probe intercepts all LangGraph lifecycle hooks (`on_chain_start`, `on_chain_end`, `on_llm_end`, `on_tool_start`, etc.) and streams structured events to Redis without blocking your agent.

### Replaying a past run

Past runs are stored in Redis for 24 hours. The dashboard's **Recent runs** dropdown lists them. You can also fetch them via the REST API:

```bash
# List all runs
curl http://localhost:8000/api/runs

# Replay events for a specific run
curl http://localhost:8000/api/runs/run-3f8a1c2b/events

# Get current materialised state
curl http://localhost:8000/api/runs/run-3f8a1c2b/state
```

---

## Dashboard Panels

| Panel | What it shows |
|---|---|
| **DAG Canvas** | Live node graph — gray (pending), pulsing yellow (active), green (success), red (error) |
| **Event Log** | Chronological stream of every TraceEvent, click any row to select that node |
| **State Inspector** | RFC 6902 JSON diff — what changed in agent state at the selected node |
| **Critic** | LLM-assigned alignment scores (0–1) and divergence flags per node |
| **Flame Graph** | Bar chart of node execution time (width) and token usage (colour heat) |

---

## Docker (all-in-one)

```bash
cp .env.example .env   # add OPENAI_API_KEY if desired
docker-compose up --build
```

Services: Redis on `6379`, backend on `8000`, frontend on `3000`.
