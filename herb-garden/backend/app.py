"""Sprout & Spoon — local Flask backend.

Acts as a private proxy between the browser frontend and Adafruit IO so
the AIO key never leaves the host machine. Serves the static frontend
on the same origin to keep CORS out of the picture.

Endpoints:
    GET  /                    -> herb-garden/index.html (and static files)
    GET  /api/health          -> { configured, feeds }
    GET  /api/telemetry       -> latest reading across the AIO telemetry feeds
    POST /api/water           -> writes "water:<duration_ms>" to water-command
    POST /api/selected-herb   -> writes herb id to selected-herb

Config (read from environment, see backend/.env.example):
    AIO_USERNAME              Adafruit IO username (required for live mode)
    AIO_KEY                   Adafruit IO key      (required for live mode)
    AIO_FEED_*                Optional feed slug overrides
    HOST, PORT                Defaults 127.0.0.1:8000
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory

try:
    from dotenv import load_dotenv  # optional dependency; convenient for dev
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass


AIO_BASE = "https://io.adafruit.com/api/v2"
ROOT = Path(__file__).resolve().parent.parent  # herb-garden/

AIO_USER = os.environ.get("AIO_USERNAME", "").strip()
AIO_KEY = os.environ.get("AIO_KEY", "").strip()

FEEDS = {
    "moisture_pct":    os.environ.get("AIO_FEED_MOISTURE",    "soil-moisture"),
    "temperature_c":   os.environ.get("AIO_FEED_TEMPERATURE", "temperature"),
    "humidity_pct":    os.environ.get("AIO_FEED_HUMIDITY",    "humidity"),
    "light_lux":       os.environ.get("AIO_FEED_LIGHT",       "light-level"),
    "reservoir_level": os.environ.get("AIO_FEED_RESERVOIR",   "water-reservoir"),
    "pump_status":     os.environ.get("AIO_FEED_PUMP_STATUS", "pump-status"),
}
WATER_CMD_FEED     = os.environ.get("AIO_FEED_WATER_COMMAND", "water-command")
SELECTED_HERB_FEED = os.environ.get("AIO_FEED_SELECTED_HERB", "selected-herb")

# Mirrors herb-garden/js/sources.js LIMITS — out-of-range values get dropped.
LIMITS = {
    "moisture_pct":    (0, 100),
    "temperature_c":   (-20, 60),
    "humidity_pct":    (0, 100),
    "light_lux":       (0, 200_000),
    "reservoir_level": (0, 100),
}
HERBS_ALLOWED = {"basil", "parsley", "thyme", "mint"}
WATER_MS_MIN, WATER_MS_MAX = 100, 30_000
HTTP_TIMEOUT_S = 8

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
_executor = ThreadPoolExecutor(max_workers=6)


def _configured() -> bool:
    return bool(AIO_USER and AIO_KEY)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_iso(value: str | None) -> str | None:
    """Normalise an Adafruit IO created_at string to UTC ISO with 'Z'.

    Returns None if the value is missing or unparseable so the frontend
    can render "device clock not synced" gracefully.
    """
    if not value:
        return None
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None
    return d.isoformat(timespec="seconds").replace("+00:00", "Z")


def _clean_number(field: str, value):
    if value is None:
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    lo, hi = LIMITS.get(field, (None, None))
    if lo is not None and (n < lo or n > hi):
        return None
    return n


def _aio_get_last(feed_key: str):
    if not feed_key:
        return None
    url = f"{AIO_BASE}/{AIO_USER}/feeds/{feed_key}/data/last"
    try:
        r = requests.get(
            url,
            headers={"X-AIO-Key": AIO_KEY, "Accept": "application/json"},
            timeout=HTTP_TIMEOUT_S,
        )
        if r.status_code == 404:
            return None  # feed doesn't exist yet — not an error
        r.raise_for_status()
        return r.json()
    except requests.RequestException as exc:
        return {"_error": str(exc)}


def _aio_post(feed_key: str, value: str):
    url = f"{AIO_BASE}/{AIO_USER}/feeds/{feed_key}/data"
    r = requests.post(
        url,
        headers={"X-AIO-Key": AIO_KEY, "Content-Type": "application/json"},
        json={"value": value},
        timeout=HTTP_TIMEOUT_S,
    )
    r.raise_for_status()
    return r.json()


# --------------------------------------------------------------------- routes

@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "configured": _configured(),
        "feeds": {
            **FEEDS,
            "water_command": WATER_CMD_FEED,
            "selected_herb": SELECTED_HERB_FEED,
        },
    })


@app.get("/api/telemetry")
def telemetry():
    if not _configured():
        return jsonify({
            "configured": False,
            "error": "Backend missing AIO_USERNAME / AIO_KEY in backend/.env",
            "fetched_at": _now_iso(),
        }), 503

    # Fan out across all telemetry feeds in parallel.
    futures = {field: _executor.submit(_aio_get_last, feed) for field, feed in FEEDS.items()}
    raw = {field: f.result() for field, f in futures.items()}

    out = {
        "configured": True,
        "fetched_at": _now_iso(),
        "moisture_pct":    None,
        "temperature_c":   None,
        "humidity_pct":    None,
        "light_lux":       None,
        "reservoir_level": None,
        "pump_status":     None,
        "timestamp":       None,
        "time_valid":      False,
        "feed_errors":     {},
    }

    newest_iso = None
    for field, datum in raw.items():
        if datum is None:
            continue
        if isinstance(datum, dict) and "_error" in datum:
            out["feed_errors"][field] = datum["_error"]
            continue
        value = datum.get("value")
        if field == "pump_status":
            out["pump_status"] = str(value) if value is not None else None
        else:
            out[field] = _clean_number(field, value)
        created_at = _parse_iso(datum.get("created_at"))
        if created_at and (newest_iso is None or created_at > newest_iso):
            newest_iso = created_at

    out["timestamp"] = newest_iso
    out["time_valid"] = newest_iso is not None
    return jsonify(out)


@app.post("/api/water")
def water():
    if not _configured():
        return jsonify({"error": "Backend missing AIO_USERNAME / AIO_KEY"}), 503
    body = request.get_json(silent=True) or {}
    try:
        duration_ms = int(body.get("duration_ms", 3000))
    except (TypeError, ValueError):
        return jsonify({"error": "duration_ms must be an integer"}), 400
    if duration_ms < WATER_MS_MIN or duration_ms > WATER_MS_MAX:
        return jsonify({
            "error": f"duration_ms out of bounds ({WATER_MS_MIN}..{WATER_MS_MAX})",
        }), 400
    value = f"water:{duration_ms}"
    try:
        _aio_post(WATER_CMD_FEED, value)
    except requests.RequestException as exc:
        return jsonify({"error": f"AIO post failed: {exc}"}), 502
    return jsonify({"ok": True, "value": value})


@app.post("/api/selected-herb")
def selected_herb():
    if not _configured():
        return jsonify({"error": "Backend missing AIO_USERNAME / AIO_KEY"}), 503
    body = request.get_json(silent=True) or {}
    herb = str(body.get("herb", "")).strip().lower()
    if herb not in HERBS_ALLOWED:
        return jsonify({
            "error": f"herb must be one of {sorted(HERBS_ALLOWED)}",
        }), 400
    try:
        _aio_post(SELECTED_HERB_FEED, herb)
    except requests.RequestException as exc:
        return jsonify({"error": f"AIO post failed: {exc}"}), 502
    return jsonify({"ok": True, "herb": herb})


@app.get("/")
def index():
    return send_from_directory(str(ROOT), "index.html")


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host=host, port=port, debug=debug)
