"""
FastAPI application entry point for the Agent Debugger backend.

Startup sequence
----------------
1. Connect to Redis (shared client on app.state.redis).
2. Start RedisSubscriber background task (Pub/Sub → WebSocket fan-out).
3. Start CriticWorker background task (async LLM alignment scoring).

Endpoints
---------
WS  /ws/{run_id}                  — real-time trace stream for one run
GET /api/runs                     — list all runs
GET /api/runs/{run_id}/events     — replay events from Redis Stream
GET /api/runs/{run_id}/state      — materialised state snapshot
DEL /api/runs/{run_id}            — purge a run
GET /health                       — health check
"""
from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # loads .env from the repo root before any os.getenv() calls

import redis.asyncio as aioredis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.api.runs import router as runs_router
from backend.api.builder import router as builder_router
from backend.critic_worker import CriticWorker
from backend.redis_subscriber import RedisSubscriber
from backend.state_delta_engine import StateDeltaEngine
from backend.ws_manager import ConnectionManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
_HYDRATE_LIMIT = 200  # max events sent to late-joining clients


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──────────────────────────────────────────────────────
    redis_client = await aioredis.from_url(
        _REDIS_URL, encoding="utf-8", decode_responses=True
    )
    app.state.redis = redis_client
    app.state.manager = ConnectionManager()
    app.state.delta_engine = StateDeltaEngine(redis_client)

    subscriber = RedisSubscriber(manager=app.state.manager)
    await subscriber.start()

    critic = CriticWorker()
    await critic.start()

    app.state.subscriber = subscriber
    app.state.critic = critic

    logger.info("Backend started — Redis: %s", _REDIS_URL)
    yield

    # ── shutdown ─────────────────────────────────────────────────────
    await subscriber.stop()
    await critic.stop()
    await redis_client.aclose()
    logger.info("Backend stopped")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Agent Debugger & Trajectory Visualizer API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(runs_router, prefix="/api")
app.include_router(builder_router, prefix="/api")


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws/{run_id}")
async def websocket_endpoint(websocket: WebSocket, run_id: str) -> None:
    manager: ConnectionManager = websocket.app.state.manager
    redis_client: aioredis.Redis = websocket.app.state.redis  # type: ignore[type-arg]
    delta_engine: StateDeltaEngine = websocket.app.state.delta_engine

    await manager.connect(websocket, run_id)
    try:
        # ── hydrate late-joining client ───────────────────────────────
        materialized = await delta_engine.get_full_run_state(run_id)
        stream_key = f"stream:run:{run_id}"
        raw_entries = await redis_client.xrevrange(stream_key, count=_HYDRATE_LIMIT)
        raw_entries.reverse()  # chronological order

        events: list[dict] = []
        for _eid, fields in raw_entries:
            raw = fields.get("data", "")
            if raw:
                try:
                    events.append(json.loads(raw))
                except json.JSONDecodeError:
                    pass

        last_seq = max((e.get("sequence", 0) for e in events), default=0)
        hydrate_msg = {
            "type": "HYDRATE",
            "run_id": run_id,
            "materialized_state": materialized,
            "events": events,
            "last_sequence": last_seq,
        }
        await websocket.send_text(json.dumps(hydrate_msg))

        # ── keep alive / wait for disconnect ─────────────────────────
        while True:
            # We don't expect client→server messages but we must await
            # something to detect disconnection.
            data = await websocket.receive_text()
            # Clients may send a "ping" to keep the connection alive
            if data.strip() == "ping":
                await websocket.send_text('{"type":"pong"}')

    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket, run_id)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
