"""
RedisSubscriber — background asyncio task that pattern-subscribes to all
``trace:*`` Pub/Sub channels and fans incoming messages out to the
ConnectionManager's WebSocket clients.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

import redis.asyncio as aioredis

from .ws_manager import ConnectionManager

logger = logging.getLogger(__name__)

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


class RedisSubscriber:
    def __init__(self, manager: ConnectionManager) -> None:
        self._manager = manager
        self._client: Optional[aioredis.Redis] = None  # type: ignore[type-arg]
        self._pubsub: Optional[aioredis.client.PubSub] = None
        self._task: Optional[asyncio.Task[None]] = None

    async def start(self) -> None:
        self._client = await aioredis.from_url(
            _REDIS_URL, encoding="utf-8", decode_responses=True
        )
        self._pubsub = self._client.pubsub(ignore_subscribe_messages=True)
        await self._pubsub.psubscribe("trace:*")
        self._task = asyncio.create_task(self._listen(), name="redis-subscriber")
        logger.info("RedisSubscriber started — listening on trace:*")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._pubsub:
            await self._pubsub.punsubscribe("trace:*")
            await self._pubsub.aclose()
        if self._client:
            await self._client.aclose()
        logger.info("RedisSubscriber stopped")

    async def _listen(self) -> None:
        assert self._pubsub is not None
        try:
            async for message in self._pubsub.listen():
                if message is None:
                    continue
                if message.get("type") not in ("pmessage", "message"):
                    continue

                channel: str = message.get("channel", "")
                data: str = message.get("data", "")

                # channel format: "trace:{run_id}"
                parts = channel.split(":", 1)
                if len(parts) != 2:
                    continue
                run_id = parts[1]

                await self._manager.broadcast(run_id, data)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("RedisSubscriber._listen crashed — task ending")
