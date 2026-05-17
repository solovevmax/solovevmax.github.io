"""Basic sanity checks for sensor values. Out-of-range -> None."""

LIMITS = {
    "moisture":       (0,   100),
    "temperature":    (-20, 60),
    "humidity":       (0,   100),
    "ph":             (0,   14),
    "light_lux":      (0,   200000),
    "reservoir_level": (0,  100),
}


def clean(field: str, value):
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    lo, hi = LIMITS[field]
    if v < lo or v > hi:
        return None
    return v
