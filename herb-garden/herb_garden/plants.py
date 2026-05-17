"""Plant reference database.

Add a new herb by appending a dict to PLANTS with the same shape as basil.
Ranges are based on common care guidance for the plant. "ideal" is the
sweet spot (sub-score 100). "ok" is the wider tolerable range (sub-score
tapers from 100 at the edge of ideal down to 50 at the edge of ok, then
to 0 outside ok). Weights must sum to 1.0.
"""

PLANTS = {
    "basil": {
        "id": "basil",
        "common_name": "Basil",
        "scientific_name": "Ocimum basilicum",
        "image": "basil",
        "notes": (
            "Warm conditions; moist but well-drained soil; "
            "soil pH around 6.0-7.0; full sun (4-6+ hours/day)."
        ),
        "ranges": {
            "moisture_pct":  {"ideal": [40, 70],   "ok": [25, 85]},
            "temperature_c": {"ideal": [18, 27],   "ok": [13, 32]},
            "humidity_pct":  {"ideal": [40, 60],   "ok": [30, 80]},
            "ph":            {"ideal": [6.0, 7.0], "ok": [5.5, 7.5]},
            "light_lux":     {"ideal": [10000, 50000], "ok": [3000, 100000]},
        },
        "weights": {
            "moisture_pct": 0.30,
            "temperature_c": 0.20,
            "light_lux": 0.20,
            "humidity_pct": 0.10,
            "ph": 0.10,
            "reservoir": 0.10,
        },
        "moisture_threshold_pct": 35,
        "watering_cooldown_s": 600,
    },
}


def get_plant(plant_id: str) -> dict:
    if plant_id not in PLANTS:
        raise KeyError(f"Unknown plant: {plant_id}")
    return PLANTS[plant_id]


def list_plants() -> list:
    return [
        {"id": p["id"], "common_name": p["common_name"]}
        for p in PLANTS.values()
    ]
