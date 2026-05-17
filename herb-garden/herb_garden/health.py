"""Plant Health (1-100) computed transparently from sub-scores."""

from typing import Optional

METRIC_LABELS = {
    "moisture_pct": "moisture",
    "temperature_c": "temperature",
    "humidity_pct": "humidity",
    "ph": "pH",
    "light_lux": "light",
    "reservoir": "reservoir",
}


def _range_subscore(value: Optional[float], ideal, ok) -> float:
    """Score 0-100 for a value vs. its ideal/ok ranges.

    100 inside ideal. Linear 100->50 from ideal edge to ok edge.
    Linear 50->0 over an equal-width buffer outside ok. Clamped.
    """
    if value is None:
        return 0.0
    imin, imax = ideal
    omin, omax = ok
    if imin <= value <= imax:
        return 100.0
    # Below ideal
    if value < imin:
        if value >= omin:
            frac = (value - omin) / (imin - omin) if imin > omin else 1.0
            return 50.0 + 50.0 * frac
        buf = imin - omin
        if buf <= 0:
            return 0.0
        frac = (omin - value) / buf
        return max(0.0, 50.0 - 50.0 * frac)
    # Above ideal
    if value <= omax:
        frac = (omax - value) / (omax - imax) if omax > imax else 1.0
        return 50.0 + 50.0 * frac
    buf = omax - imax
    if buf <= 0:
        return 0.0
    frac = (value - omax) / buf
    return max(0.0, 50.0 - 50.0 * frac)


def _reservoir_subscore(level_pct: Optional[float]) -> float:
    if level_pct is None:
        return 0.0
    # 100% -> 100, 30% -> ~50, 0% -> 0
    return max(0.0, min(100.0, level_pct))


def compute_health(plant: dict, reading: dict) -> dict:
    """Return {score, subscores, explanation} for the given reading.

    reading keys: moisture_pct, temperature_c, humidity_pct, ph, light_lux,
                  reservoir_level (any can be None). Missing metrics are
                  excluded from the weighted average (weight redistributes
                  across available metrics) rather than penalizing the score.
    """
    weights = plant["weights"]
    ranges = plant["ranges"]
    subscores = {}
    present = {}

    for metric, rng in ranges.items():
        val = reading.get(metric)
        if val is None:
            continue
        subscores[metric] = _range_subscore(val, rng["ideal"], rng["ok"])
        present[metric] = weights[metric]

    res_val = reading.get("reservoir_level")
    if res_val is not None:
        subscores["reservoir"] = _reservoir_subscore(res_val)
        present["reservoir"] = weights["reservoir"]

    if not subscores:
        return {"score": 1, "subscores": {}, "explanation": "No data"}

    total_w = sum(present.values())
    score = sum(subscores[m] * present[m] for m in present) / total_w
    score = max(1, min(100, round(score)))

    worst_metric, worst_value = min(subscores.items(), key=lambda kv: kv[1])
    if all(v >= 80 for v in subscores.values()):
        explanation = "Thriving"
    elif worst_value >= 60:
        explanation = "Doing well"
    elif worst_metric == "reservoir":
        explanation = "Reservoir low"
    else:
        label = METRIC_LABELS[worst_metric]
        ideal = ranges[worst_metric]["ideal"]
        val = reading.get(worst_metric)
        mid = (ideal[0] + ideal[1]) / 2
        direction = "Low" if val < mid else "High"
        explanation = f"{direction} {label}"

    return {
        "score": score,
        "subscores": {k: round(v, 1) for k, v in subscores.items()},
        "explanation": explanation,
    }
