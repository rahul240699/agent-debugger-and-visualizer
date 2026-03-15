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
from typing import Optional

import redis.asyncio as aioredis

from shared.schema.trace_event import TraceEvent

logger = logging.getLogger(__name__)

_STREAM_MAXLEN = 10_000   # trim each run stream to last 10 k events
_RUN_INDEX_KEY = "runs"   # sorted set: member=run_id, score=timestamp_ms


class RedisEmitter:
    def __init__(self, redis_url: str = "redis://localhost:6379") -> None:
        self._redis_url = redis_url
        self._client: Optional[aioredis.Redis] = None  # type: ignore[type-arg]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_client(self) -> aioredis.Redis:  # type: ignore[type-arg]
        if self._client is None:
            self._client = await aioredis.from_url(
                self._redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
        return self._client

    async def _do_publish(self, event: TraceEvent) -> None:
        """Actual Redis I/O — runs as a background Task."""
        try:
            client = await self._get_client()
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
                nx=True,  # only set if not already present
            )
        except Exception:
            logger.exception(
                "RedisEmitter: failed to publish event_id=%s run_id=%s",
                event.event_id,
                event.run_id,
            )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def emit(self, event: TraceEvent) -> None:
        """
        Schedule the publish as a non-blocking asyncio Task.
        Safe to call from both sync and async contexts.
        """
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._do_publish(event))
        except RuntimeError:
            # No running event loop (e.g. called from a purely sync context).
            asyncio.run(self._do_publish(event))

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
