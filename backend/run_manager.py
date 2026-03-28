"""
In-process registry of active run handles for interrupt/resume support.

Each Pipeline Builder run that uses interrupt_before registers a RunHandle
here. The interrupt API endpoints look up the handle to signal resume or apply
a state patch before resuming.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RunHandle:
    run_id: str
    graph: Any                   # CompiledStateGraph (untyped to avoid circular imports)
    config: dict                 # {"configurable": {"thread_id": run_id}}
    #
    resume_event: threading.Event = field(default_factory=threading.Event)
    state_patch: dict[str, Any] | None = None
    status: str = "RUNNING"      # RUNNING | INTERRUPTED | COMPLETE | ERROR
    interrupted_nodes: list[str] = field(default_factory=list)
    interrupted_state: dict[str, Any] = field(default_factory=dict)
    cancel: bool = False


# ---------------------------------------------------------------------------
# Thread-safe registry
# ---------------------------------------------------------------------------

_handles: dict[str, RunHandle] = {}
_lock = threading.Lock()


def register(run_id: str, handle: RunHandle) -> None:
    with _lock:
        _handles[run_id] = handle


def get(run_id: str) -> RunHandle | None:
    with _lock:
        return _handles.get(run_id)


def remove(run_id: str) -> None:
    with _lock:
        _handles.pop(run_id, None)
