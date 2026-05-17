"""Flask entry point. Serves the SPA + a small JSON API."""

import os
import threading
import time

from flask import Flask, jsonify, request, send_from_directory

from herb_garden.config import Settings
from herb_garden.controller import GardenController
from herb_garden.events import EventLog
from herb_garden.plants import list_plants, get_plant

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
STATIC_DIR = os.path.join(BASE, "static")

settings = Settings(os.path.join(DATA_DIR, "settings.json"))
events = EventLog(os.path.join(DATA_DIR, "events.json"))
controller = GardenController(settings, events)


def _background_ticker():
    """Drive auto-water + alert logic continuously, even with no UI open."""
    while True:
        try:
            controller.background_tick()
        except Exception:
            pass
        time.sleep(1.0)


threading.Thread(target=_background_ticker, daemon=True).start()

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/state")
def api_state():
    return jsonify(controller.snapshot())


@app.route("/api/plants")
def api_plants():
    return jsonify(list_plants())


@app.route("/api/plant/<plant_id>")
def api_plant(plant_id):
    return jsonify(get_plant(plant_id))


@app.route("/api/events")
def api_events():
    kind = request.args.get("kind")
    limit = int(request.args.get("limit", 50))
    return jsonify(events.recent(kind=kind, limit=limit))


@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    if request.method == "POST":
        patch = request.get_json(force=True) or {}
        source_keys = {"data_source", "serial_port", "serial_baud"}
        was = settings.all()
        updated = settings.update(patch)
        if any(was.get(k) != updated.get(k) for k in source_keys):
            controller.reload_source()
        return jsonify(updated)
    return jsonify(settings.all())


@app.route("/api/water", methods=["POST"])
def api_water():
    controller.manual_water()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
