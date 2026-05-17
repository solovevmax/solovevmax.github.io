"""User-editable settings persisted to JSON. Overlay over plant defaults."""

import json
import os
import threading

_LOCK = threading.Lock()

DEFAULTS = {
    "selected_plant": "basil",
    "moisture_threshold_pct": 35,
    "watering_cooldown_s": 600,
    "watering_duration_ms": 3000,
    "low_reservoir_pct": 20,
    "stale_after_s": 10,
    "notifications_enabled": True,
    "data_source": "mock",   # "mock" | "serial"
    "serial_port": "",       # e.g. "/dev/ttyACM0" or "COM3"
    "serial_baud": 115200,
}


class Settings:
    def __init__(self, path: str):
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            with open(path, "w") as f:
                json.dump(DEFAULTS, f, indent=2)
        self._cache = self._read()

    def _read(self) -> dict:
        try:
            with open(self.path) as f:
                data = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            data = {}
        return {**DEFAULTS, **data}

    def get(self, key):
        return self._cache.get(key, DEFAULTS.get(key))

    def all(self) -> dict:
        return dict(self._cache)

    def update(self, patch: dict):
        with _LOCK:
            allowed = {k: v for k, v in patch.items() if k in DEFAULTS}
            self._cache = {**self._cache, **allowed}
            with open(self.path, "w") as f:
                json.dump(self._cache, f, indent=2)
        return self.all()
