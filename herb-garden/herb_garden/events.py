"""Append-only event log: watering events + alerts. JSON file on disk."""

import json
import os
import threading
from datetime import datetime, timezone
from typing import List

_LOCK = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class EventLog:
    def __init__(self, path: str, max_entries: int = 500):
        self.path = path
        self.max_entries = max_entries
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            with open(path, "w") as f:
                json.dump([], f)

    def _read(self) -> list:
        try:
            with open(self.path) as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _write(self, events: list):
        with open(self.path, "w") as f:
            json.dump(events[-self.max_entries:], f, indent=2)

    def add(self, kind: str, message: str, **extra):
        """kind: 'watering' | 'alert' | 'info'"""
        with _LOCK:
            events = self._read()
            events.append({
                "timestamp": _now_iso(),
                "kind": kind,
                "message": message,
                **extra,
            })
            self._write(events)

    def recent(self, kind: str = None, limit: int = 50) -> List[dict]:
        with _LOCK:
            events = self._read()
        if kind:
            events = [e for e in events if e["kind"] == kind]
        return list(reversed(events[-limit:]))

    def last_of(self, kind: str) -> dict:
        with _LOCK:
            events = self._read()
        for e in reversed(events):
            if e["kind"] == kind:
                return e
        return None
