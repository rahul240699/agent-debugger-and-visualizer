"""
RedisEmitter — fire-and-forget async Redis publisher.

All emissions are scheduled as asyncio Tasks so the LangGraph agent's
hot path is never blocked regardless of Redis latency.

Persistence strategy:
  • Redis Pub/Sub  → live WebSocket fan-out (Module B subscribers)
  • Redis Stream   → ordered, replayable event log (24-hour TTL)
  • Redis ZSet     → run_id index sorted by first-seen timestamp
"""
from __future__ import annotations

import asyncio
import logging
import threading

import redis.asyncio as aioredis

from shared.schema.trace_event import TraceEvent
import os
from dotenv import load_dotenv

load_dotenv()  # loads .env from the repo root before any os.getenv() calls

logger = logging.getLogger(__name__)

_STREAM_MAXLEN = 10_000   # trim each run stream to last 10 k events
_RUN_INDEX_KEY = "runs"   # sorted set: member=run_id, score=timestamp_ms


class RedisEmitter:
    def __init__(self, redis_url: str | None = None) -> None:
        self._redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _do_publish(self, event: TraceEvent) -> None:
        """Open a fresh connection, publish, then close — no shared state."""
        client = await aioredis.from_url(
            self._redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
        try:
            payload = event.model_dump_json()

            # 1. Pub/Sub channel for live streaming
            channel = f"trace:{event.run_id}"
            await client.publish(channel, payload)

            # 2. Ordered Stream for replay / late-joiners
            stream_key = f"stream:run:{event.run_id}"
            await client.xadd(
                stream_key,
                {"data": payload},
                maxlen=_STREAM_MAXLEN,
                approximate=True,
            )

            # 3. Run index (score = first-seen timestamp)
            await client.zadd(
                _RUN_INDEX_KEY,
                {event.run_id: event.timestamp_ms},
                nx=True,
            )
        except Exception:
            logger.exception(
                "RedisEmitter: failed to publish event_id=%s run_id=%s",
                event.event_id,
                event.run_id,
            )
        finally:
            await client.aclose()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def emit(self, event: TraceEvent) -> None:
        """
        Fire-and-forget: each publish runs in its own daemon thread with a
        brand-new event loop, completely isolated from LangGraph's loop(s).
        """
        t = threading.Thread(
            target=asyncio.run,
            args=(self._do_publish(event),),
            daemon=True,
        )
        t.start()

    async def close(self) -> None:
        # no persistent client to close
        self._client = None
