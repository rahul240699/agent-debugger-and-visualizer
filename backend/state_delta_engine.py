"""
StateDeltaEngine — applies incoming RFC 6902 JSON Patch operations to a
per-run materialised state snapshot stored in Redis.

Responsibilities
----------------
• Apply each incoming state_delta patch to the running materialised state.
• Store the result in Redis so late-joining WebSocket clients can hydrate.
• Track node visit counts for loop / retry detection.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import jsonpatch
import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

_STATE_TTL_SECONDS = 86_400  # 24 hours


class StateDeltaEngine:
    def __init__(self, redis_client: aioredis.Redis) -> None:  # type: ignore[type-arg]
        self._redis = redis_client

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def apply_delta(
        self,
        run_id: str,
        node_id: str,
        patch_ops: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Apply *patch_ops* (RFC 6902) to the node's materialised state stored
        in Redis.  Returns the updated state.
        """
        key = f"state:run:{run_id}:{node_id}"
        raw = await self._redis.get(key)
        current: dict[str, Any] = json.loads(raw) if raw else {}

        if patch_ops:
            try:
                patch = jsonpatch.JsonPatch(patch_ops)
                current = patch.apply(current)
            except jsonpatch.JsonPatchException:
                logger.exception(
                    "StateDeltaEngine: failed to apply patch run=%s node=%s",
                    run_id,
                    node_id,
                )

        await self._redis.setex(key, _STATE_TTL_SECONDS, json.dumps(current))
        return current

    async def get_state(
        self, run_id: str, node_id: str
    ) -> dict[str, Any]:
        key = f"state:run:{run_id}:{node_id}"
        raw = await self._redis.get(key)
        return json.loads(raw) if raw else {}

    async def get_full_run_state(self, run_id: str) -> dict[str, Any]:
        """Return materialised state for every node in *run_id*."""
        pattern = f"state:run:{run_id}:*"
        keys = await self._redis.keys(pattern)
        if not keys:
            return {}
        values = await self._redis.mget(*keys)
        result: dict[str, Any] = {}
        for key, raw in zip(keys, values):
            node_id = key.split(":", 3)[-1]
            result[node_id] = json.loads(raw) if raw else {}
        return result

    async def increment_node_visits(self, run_id: str, node_id: str) -> int:
        key = f"visits:run:{run_id}:{node_id}"
        count = await self._redis.incr(key)
        await self._redis.expire(key, _STATE_TTL_SECONDS)
        return int(count)
