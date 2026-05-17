"""Glue layer: pulls readings from the DataSource, runs auto-water logic,
emits alerts, and produces the snapshot dict the UI renders.
"""

import time

from .data_sources import MockDataSource, SerialDataSource
from .events import EventLog
from .config import Settings
from .health import compute_health
from .plants import get_plant


class GardenController:
    def __init__(self, settings: Settings, events: EventLog):
        self.settings = settings
        self.events = events
        self.source = self._build_source()
        self.source.start()
        self._last_water_ts: float = 0.0
        self._last_reading_ts: float = 0.0
        self._stale_alert_active = False
        self._low_res_alert_active = False
        self._disconnected_alert_active = False

    def _build_source(self):
        if self.settings.get("data_source") == "serial":
            port = self.settings.get("serial_port")
            baud = self.settings.get("serial_baud")
            if not port:
                # Fall back to mock if no port configured.
                return MockDataSource()
            return SerialDataSource(port=port, baud=baud,
                                    stale_after_s=self.settings.get("stale_after_s"))
        return MockDataSource()

    # --- Live state for the UI -------------------------------------------------

    def snapshot(self) -> dict:
        plant = get_plant(self.settings.get("selected_plant"))
        reading = self.source.get_latest()
        now = time.time()

        # Auto-water and alert logic runs on each poll.
        self._tick(plant, reading, now)

        health = compute_health(plant, reading) if reading else {
            "score": 1, "subscores": {}, "explanation": "No data",
        }
        last_water = self.events.last_of("watering")
        return {
            "plant": {
                "id": plant["id"],
                "common_name": plant["common_name"],
                "scientific_name": plant["scientific_name"],
                "image": plant["image"],
                "notes": plant["notes"],
                "ranges": plant["ranges"],
                "weights": plant["weights"],
            },
            "reading": reading,
            "health": health,
            "connection": {
                "connected": self.source.is_connected,
                "source_label": self.source.source_label,
                "is_demo": isinstance(self.source, MockDataSource),
                "stale": self._is_stale(reading, now),
            },
            "last_watered": last_water,
            "settings": self.settings.all(),
        }

    # --- Internal --------------------------------------------------------------

    def _is_stale(self, reading, now) -> bool:
        if not reading:
            return True
        # Use receipt time of the latest update.
        return (now - self._last_reading_ts) > self.settings.get("stale_after_s")

    def _tick(self, plant, reading, now):
        if reading:
            self._last_reading_ts = now

        # Stale-data alert
        stale = self._is_stale(reading, now)
        if stale and not self._stale_alert_active:
            self.events.add("alert", "Stale sensor data: no updates received")
            self._stale_alert_active = True
        elif not stale and self._stale_alert_active:
            self._stale_alert_active = False

        # Disconnected alert
        if not self.source.is_connected and not self._disconnected_alert_active:
            self.events.add("alert", "Arduino disconnected")
            self._disconnected_alert_active = True
        elif self.source.is_connected and self._disconnected_alert_active:
            self._disconnected_alert_active = False

        if not reading:
            return

        # Low reservoir alert (edge-triggered)
        res = reading.get("reservoir_level")
        low_res = self.settings.get("low_reservoir_pct")
        if res is not None and res < low_res:
            if not self._low_res_alert_active:
                self.events.add("alert", f"Low reservoir ({res:.0f}%) - refill needed")
                self._low_res_alert_active = True
        else:
            self._low_res_alert_active = False

        # Auto-water
        moisture = reading.get("moisture_pct")
        threshold = self.settings.get("moisture_threshold_pct")
        cooldown = self.settings.get("watering_cooldown_s")
        if (moisture is not None
                and moisture < threshold
                and (now - self._last_water_ts) > cooldown
                and (res is None or res >= low_res)):
            self._trigger_watering(now)

    def _trigger_watering(self, now):
        dur = self.settings.get("watering_duration_ms")
        self.source.send_command({"cmd": "water", "duration_ms": dur})
        self._last_water_ts = now
        self.events.add("watering", "Watering completed", duration_ms=dur)

    # --- User actions ---------------------------------------------------------

    def manual_water(self):
        self._trigger_watering(time.time())

    def background_tick(self):
        """Run the auto-water + alert logic without needing a UI poll."""
        plant = get_plant(self.settings.get("selected_plant"))
        reading = self.source.get_latest()
        self._tick(plant, reading, time.time())

    def reload_source(self):
        """Apply settings changes to the data source (mock <-> serial swap)."""
        try:
            self.source.stop()
        except Exception:
            pass
        self.source = self._build_source()
        self.source.start()
