"""
StateDiffEngine — computes RFC 6902 JSON Patch operations between consecutive
agent state snapshots on a per-(run_id, node_id) basis.

Only the patch array is ever serialised onto the wire; full state objects stay
local to the probe process.
"""
from __future__ import annotations

import logging
from typing import Any

import jsonpatch

from shared.schema.trace_event import JsonPatchOp

logger = logging.getLogger(__name__)


class StateDiffEngine:
    """
    Maintains previous-state snapshots keyed by ``run_id:node_id`` and
    exposes a single :meth:`compute_patch` method that returns only the delta.

    Thread-safety: instances are per-probe (single agent process), so no
    locking is required.
    """

    def __init__(self) -> None:
        self._prev: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def compute_patch(
        self,
        run_id: str,
        node_id: str,
        new_state: dict[str, Any],
    ) -> list[JsonPatchOp]:
        """
        Diff ``new_state`` against the last known state for this
        ``(run_id, node_id)`` pair and return the RFC 6902 patch ops.

        Also advances the internal snapshot so the next call diffs against
        the current ``new_state``.
        """
        key = f"{run_id}:{node_id}"
        prev = self._prev.get(key, {})

        try:
            patch = jsonpatch.make_patch(prev, new_state)
            ops: list[JsonPatchOp] = []
            for op_dict in patch.patch:
                ops.append(
                    JsonPatchOp(
                        op=op_dict["op"],
                        path=op_dict["path"],
                        value=op_dict.get("value"),
                        **{"from": op_dict["from"]} if "from" in op_dict else {},
                    )
                )
        except Exception:
            logger.exception(
                "StateDiffEngine: patch computation failed for key=%s", key
            )
            ops = []

        self._prev[key] = new_state
        return ops

    def reset_run(self, run_id: str) -> None:
        """Drop all cached state for a completed run to free memory."""
        keys = [k for k in self._prev if k.startswith(f"{run_id}:")]
        for k in keys:
            del self._prev[k]
