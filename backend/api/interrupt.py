"""
Interrupt / resume endpoints for Pipeline Builder runs.

GET  /api/runs/{run_id}/interrupt-state   — current paused state snapshot
POST /api/runs/{run_id}/resume            — approve or edit-and-resume
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.run_manager import get as get_handle

logger = logging.getLogger(__name__)

router = APIRouter()


class ResumeRequest(BaseModel):
    action: str                   # "approve" | "edit"
    state_patch: dict | None = None


@router.get("/runs/{run_id}/interrupt-state")
async def get_interrupt_state(run_id: str) -> dict:
    """Return the current interrupted state for a paused run."""
    handle = get_handle(run_id)
    if not handle or handle.status != "INTERRUPTED":
        raise HTTPException(
            status_code=404,
            detail="No active interrupt for this run.",
        )
    return {
        "interrupted_nodes": handle.interrupted_nodes,
        "state": handle.interrupted_state,
    }


@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str, req: ResumeRequest) -> dict:
    """
    Resume a paused run.

    action="approve"  → resume without changes.
    action="edit"     → apply state_patch via graph.update_state(), then resume.
    """
    handle = get_handle(run_id)
    if not handle:
        raise HTTPException(
            status_code=404,
            detail="Run not found or already complete.",
        )
    if handle.status != "INTERRUPTED":
        raise HTTPException(
            status_code=400,
            detail=f"Run is not interrupted (current status: {handle.status}).",
        )

    if req.action == "edit" and req.state_patch:
        handle.state_patch = req.state_patch

    handle.resume_event.set()
    logger.info("Run %s resumed (action=%s)", run_id, req.action)
    return {"ok": True, "run_id": run_id}
