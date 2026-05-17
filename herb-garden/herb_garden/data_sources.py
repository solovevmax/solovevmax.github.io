"""DataSource interface with two implementations: Mock and Serial.

Both expose:
    .start()                            # begin producing readings
    .stop()
    .get_latest() -> dict | None        # most recent validated reading
    .send_command(cmd_dict)             # e.g. {"cmd": "water", "duration_ms": 3000}
    .is_connected: bool                 # for the UI badge
    .source_label: str                  # "Demo Data" or "Live (port)"

Readings are dicts shaped like:
    {
      "timestamp": ISO8601 str,
      "moisture_pct": float|None, "temperature_c": float|None,
      "humidity_pct": float|None, "ph": float|None,
      "light_lux": float|None,   "reservoir_level": float|None,
      "pump_event": str|None,
    }
"""

import json
import math
import random
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from .validation import clean


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_serial_line(line: str) -> Optional[dict]:
    """Parse a JSON line from the Arduino into our normalized reading dict.

    Arduino schema (one JSON object per line):
      {"timestamp": "...", "moisture": 42.3, "temperature": 22.1,
       "humidity": 55, "ph": 6.5, "light_lux": 12000,
       "reservoir_level": 80, "pump_event": null}
    """
    try:
        raw = json.loads(line)
    except json.JSONDecodeError:
        return None
    return {
        "timestamp": raw.get("timestamp") or _now_iso(),
        "moisture_pct":    clean("moisture",        raw.get("moisture")),
        "temperature_c":   clean("temperature",     raw.get("temperature")),
        "humidity_pct":    clean("humidity",        raw.get("humidity")),
        "ph":              clean("ph",              raw.get("ph")),
        "light_lux":       clean("light_lux",       raw.get("light_lux")),
        "reservoir_level": clean("reservoir_level", raw.get("reservoir_level")),
        "pump_event":      raw.get("pump_event"),
    }


class MockDataSource:
    """Generates plausible demo readings on a background thread.

    Moisture drifts down slowly so the auto-water threshold actually triggers.
    `inject_command` mimics the pump replenishing moisture.
    """

    source_label = "Demo Data"
    is_connected = True

    def __init__(self, interval_s: float = 1.0):
        self.interval = interval_s
        self._lock = threading.Lock()
        self._latest: Optional[dict] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._moisture = 55.0
        self._reservoir = 95.0
        self._t = 0.0
        self._pending_pump: Optional[dict] = None

    def start(self):
        if self._thread:
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        while not self._stop.is_set():
            self._t += self.interval
            # Slow moisture drift down (~0.4%/s so threshold hits in ~minute)
            self._moisture = max(5.0, self._moisture - 0.4)
            pump_event = None
            if self._pending_pump:
                # Pump completes: bump moisture, drop reservoir, emit event
                self._moisture = min(85.0, self._moisture + 25.0)
                self._reservoir = max(0.0, self._reservoir - 3.0)
                pump_event = "completed"
                self._pending_pump = None

            temp = 22.0 + 2.5 * math.sin(self._t / 30.0) + random.uniform(-0.3, 0.3)
            hum = 50.0 + 8.0 * math.sin(self._t / 40.0) + random.uniform(-1, 1)
            ph = 6.5 + 0.15 * math.sin(self._t / 60.0)
            lux = max(0.0, 25000 + 20000 * math.sin(self._t / 90.0)
                      + random.uniform(-500, 500))

            reading = {
                "timestamp": _now_iso(),
                "moisture_pct": round(self._moisture, 1),
                "temperature_c": round(temp, 1),
                "humidity_pct": round(hum, 1),
                "ph": round(ph, 2),
                "light_lux": round(lux, 0),
                "reservoir_level": round(self._reservoir, 1),
                "pump_event": pump_event,
            }
            with self._lock:
                self._latest = reading
            time.sleep(self.interval)

    def get_latest(self) -> Optional[dict]:
        with self._lock:
            return dict(self._latest) if self._latest else None

    def send_command(self, cmd: dict):
        if cmd.get("cmd") == "water":
            self._pending_pump = cmd


class SerialDataSource:
    """Reads JSON-per-line frames from a USB serial port (pyserial).

    Use this when the Arduino is connected. Same interface as MockDataSource.
    """

    def __init__(self, port: str, baud: int = 115200, stale_after_s: float = 10.0):
        self.port = port
        self.baud = baud
        self.stale_after_s = stale_after_s
        self.source_label = f"Live ({port})"
        self._lock = threading.Lock()
        self._latest: Optional[dict] = None
        self._latest_ts: float = 0.0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._ser = None
        self._connected = False

    @property
    def is_connected(self) -> bool:
        if not self._connected:
            return False
        # Treat stale-stream as disconnected for UI badge purposes.
        return (time.time() - self._latest_ts) < self.stale_after_s

    def start(self):
        if self._thread:
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._ser:
            try:
                self._ser.close()
            except Exception:
                pass

    def _open(self):
        import serial  # pyserial; imported lazily so mock mode has no dep
        self._ser = serial.Serial(self.port, self.baud, timeout=1)
        self._connected = True

    def _run(self):
        import serial
        while not self._stop.is_set():
            try:
                if not self._ser:
                    self._open()
                line = self._ser.readline().decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                reading = _parse_serial_line(line)
                if reading is None:
                    continue
                with self._lock:
                    self._latest = reading
                    self._latest_ts = time.time()
            except (serial.SerialException, OSError):
                self._connected = False
                self._ser = None
                time.sleep(2.0)  # retry connect

    def get_latest(self) -> Optional[dict]:
        with self._lock:
            return dict(self._latest) if self._latest else None

    def send_command(self, cmd: dict):
        if not self._ser:
            return
        try:
            self._ser.write((json.dumps(cmd) + "\n").encode("utf-8"))
        except Exception:
            self._connected = False
