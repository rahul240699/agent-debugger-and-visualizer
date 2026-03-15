"""
REST API for historical run data.

Endpoints
---------
GET  /api/runs                        — list all run IDs (newest first)
GET  /api/runs/{run_id}/events        — ordered event replay from Redis Stream
GET  /api/runs/{run_id}/state         — current materialised state of every node
DELETE /api/runs/{run_id}             — purge a run from Redis
"""
from __future__ import annotations

import json
import os

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Request

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

router = APIRouter(tags=["runs"])


# ---------------------------------------------------------------------------
# Dependency — shared Redis client obtained via app.state
# ---------------------------------------------------------------------------


async def get_redis(request: Request) -> aioredis.Redis:  # type: ignore[type-arg]
    return request.app.state.redis


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/runs")
async def list_runs(
    limit: int = 50,
    redis: aioredis.Redis = Depends(get_redis),  # type: ignore[type-arg]
) -> list[dict]:
    """Return the most recent *limit* run IDs sorted by start timestamp."""
    # runs is a sorted set:  member=run_id, score=timestamp_ms
    pairs: list[tuple[str, float]] = await redis.zrevrangebyscore(
        "runs", "+inf", "-inf", withscores=True, start=0, num=limit
    )
    return [{"run_id": run_id, "started_at_ms": int(ts)} for run_id, ts in pairs]


@router.get("/runs/{run_id}/events")
async def get_run_events(
    run_id: str,
    since: str = "0",
    limit: int = 500,
    redis: aioredis.Redis = Depends(get_redis),  # type: ignore[type-arg]
) -> list[dict]:
    """
    Replay TraceEvents from the Redis Stream for *run_id*.

    ``since`` may be a Stream entry ID (``"1234567890-0"``) for incremental
    fetching, or ``"0"`` for all events.
    """
    stream_key = f"stream:run:{run_id}"
    exists = await redis.exists(stream_key)
    if not exists:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    entries = await redis.xrange(stream_key, min=since, count=limit)
    events: list[dict] = []
    for _entry_id, fields in entries:
        raw = fields.get("data", "")
        if raw:
            try:
                events.append(json.loads(raw))
            except json.JSONDecodeError:
                pass
    return events


@router.get("/runs/{run_id}/state")
async def get_run_state(
    run_id: str,
    redis: aioredis.Redis = Depends(get_redis),  # type: ignore[type-arg]
) -> dict:
    """Return the latest materialised state for every node in *run_id*."""
    keys = await redis.keys(f"state:run:{run_id}:*")
    if not keys:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' has no state")

    values = await redis.mget(*keys)
    state: dict[str, object] = {}
    for key, raw in zip(keys, values):
        node_id = key.split(":", 3)[-1]
        state[node_id] = json.loads(raw) if raw else {}
    return state


@router.delete("/runs/{run_id}")
async def delete_run(
    run_id: str,
    redis: aioredis.Redis = Depends(get_redis),  # type: ignore[type-arg]
) -> dict[str, str]:
    """Purge all Redis keys associated with *run_id*."""
    keys_to_delete: list[str] = []

    for pattern in (
        f"stream:run:{run_id}",
        f"state:run:{run_id}:*",
        f"visits:run:{run_id}:*",
    ):
        found = await redis.keys(pattern)
        keys_to_delete.extend(found)

    if keys_to_delete:
        await redis.delete(*keys_to_delete)

    await redis.zrem("runs", run_id)
    return {"status": "deleted", "run_id": run_id}
