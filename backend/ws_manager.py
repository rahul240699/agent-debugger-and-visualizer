"""
WebSocket ConnectionManager — manages all live client connections grouped by
run_id and broadcasts TraceEvent JSON to every connected socket in a run.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        # run_id → set of active WebSocket connections
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, run_id: str) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[run_id].add(websocket)
        logger.info("WS connected  run_id=%s  total=%d", run_id, len(self._connections[run_id]))

    async def disconnect(self, websocket: WebSocket, run_id: str) -> None:
        async with self._lock:
            self._connections[run_id].discard(websocket)
            if not self._connections[run_id]:
                del self._connections[run_id]
        logger.info("WS disconnected run_id=%s", run_id)

    async def broadcast(self, run_id: str, message: str) -> None:
        """Send *message* (JSON string) to every socket subscribed to *run_id*."""
        async with self._lock:
            sockets = set(self._connections.get(run_id, set()))

        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_text(message)
            except Exception:
                logger.debug("WS send failed — marking socket for removal")
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections[run_id].discard(ws)

    def active_run_ids(self) -> list[str]:
        return list(self._connections.keys())
