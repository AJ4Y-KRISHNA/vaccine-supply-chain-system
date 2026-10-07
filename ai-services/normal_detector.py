"""Normal-only, synthetic feature model and held-out false-alarm calibration.

This is an advisory statistical detector, not a safety or clinical classifier.
Training and calibration samples are deterministic synthetic NORMAL profiles.
"""
import math
import random
import os
from datetime import datetime, timezone, timedelta

TRAIN_SEED = 90210
CALIBRATION_SEED = 90211
TARGET_FALSE_ALARM_RATE = 0.01
FEATURE_NAMES = ("temperature_ewma_deviation_c", "temperature_rate_c_per_minute",
                 "temperature_rolling_z", "temperature_flatline_seconds")
MAX_SPEED_KMH = float(os.getenv("MAX_SPEED_KMH", "120"))
if not math.isfinite(MAX_SPEED_KMH) or MAX_SPEED_KMH <= 0:
    raise ValueError("MAX_SPEED_KMH must be positive and finite")
WINDOW_SECONDS = 1800
EWMA_TAU_SECONDS = -60 / math.log(0.7)  # alpha=0.3 at the original 60-second cadence.


def gps_plausibility(current, history):
    """Physical rule, never learned/calibrated; invalid time is not a speed."""
    result = {"flagged": False, "implied_speed_kmh": None, "max_speed_kmh": MAX_SPEED_KMH,
              "reason": "GPS speed needs two valid fixes with strictly increasing timestamps."}
    if not history:
        return result
    previous = history[-1]
    fixes = (previous, current)
    if not all(isinstance(row.get(key), (int, float)) and not isinstance(row.get(key), bool)
               and math.isfinite(row[key]) and abs(row[key]) <= limit
               for row in fixes for key, limit in (("latitude", 90), ("longitude", 180))):
        return result
    now = _minutes(current.get("recorded_at") or current.get("timestamp"))
    before = _minutes(previous.get("recorded_at") or previous.get("timestamp"))
    if now is None or before is None or now <= before:
        return result
    speed = _haversine_km(previous, current) * 60 / (now - before)
    result.update(flagged=speed > MAX_SPEED_KMH, implied_speed_kmh=speed,
                  reason=f"GPS implies {speed:.2f} km/h between consecutive fixes; "
                         f"{'exceeds' if speed > MAX_SPEED_KMH else 'within'} the physical {MAX_SPEED_KMH:g} km/h limit.")
    return result
ROUTE = ((9.9312, 76.2673), (9.951, 76.349), (9.984, 76.587),
         (10.111, 76.474), (10.026, 76.312))


def _minutes(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp() / 60
    except (ValueError, OverflowError, TypeError):
        return None


def _haversine_km(a, b):
    if not all(isinstance(row, dict) and isinstance(row.get(key), (int, float))
               for row in (a, b) for key in ("latitude", "longitude")):
        return 0.0
    radius = 6371.0
    lat1, lat2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dlat = lat2 - lat1
    dlon = math.radians(b["longitude"] - a["longitude"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(h)))


def extract_features(current, history, normal_temperature_mean=5.0):
    now = _minutes(current.get("recorded_at") or current.get("timestamp"))
    prior = [row for row in history if
             isinstance(row.get("temperature"), (int, float)) and math.isfinite(row["temperature"])
             and (now is None or (before := _minutes(row.get("recorded_at") or row.get("timestamp"))) is not None
                  and 0 < (now - before) * 60 <= WINDOW_SECONDS)]
    temperatures = [row["temperature"] for row in prior]
    if not temperatures:
        return {name: 0.0 for name in FEATURE_NAMES}, False
    ewma = float(temperatures[0])
    before = _minutes(prior[0].get("recorded_at") or prior[0].get("timestamp"))
    for row in prior[1:] + [current]:
        minute = _minutes(row.get("recorded_at") or row.get("timestamp"))
        elapsed = (minute - before) * 60 if minute is not None and before is not None else 60
        alpha = -math.expm1(-max(0, elapsed) / EWMA_TAU_SECONDS)
        ewma += alpha * (float(row["temperature"]) - ewma)
        before = minute
    ewma_deviation = ewma - normal_temperature_mean
    mean = sum(temperatures) / len(temperatures)
    variance = sum((value - mean) ** 2 for value in temperatures) / len(temperatures)
    z_score = (float(current["temperature"]) - mean) / math.sqrt(variance) if variance > 1e-9 else 0.0
    rate = 0.0
    # Adjacent 60-second bin means, divided by their observed centre separation.
    # At the original cadence this equals the consecutive C/min difference;
    # at 10 seconds it averages noise without changing the physical horizon.
    if now is not None:
        points = [( _minutes(row.get("recorded_at") or row.get("timestamp")), float(row["temperature"]))
                  for row in prior + [current]]
        recent = [(t, v) for t, v in points if t is not None and 0 <= now - t < 1]
        older = [(t, v) for t, v in points if t is not None and 1 <= now - t < 2]
        if recent and older:
            elapsed = sum(t for t, _ in recent) / len(recent) - sum(t for t, _ in older) / len(older)
            if elapsed > 0:
                rate = (sum(v for _, v in recent) / len(recent) - sum(v for _, v in older) / len(older)) / elapsed
    flatline_seconds = 0.0
    for row in reversed(prior + [current]):
        if not isinstance(row.get("temperature"), (int, float)):
            break
        if abs(float(row["temperature"]) - float(current["temperature"])) <= 1e-6:
            minute = _minutes(row.get("recorded_at") or row.get("timestamp"))
            if minute is not None and now is not None:
                flatline_seconds = max(flatline_seconds, (now - minute) * 60)
        else:
            break
    features = {
        "temperature_ewma_deviation_c": ewma_deviation,
        "temperature_rate_c_per_minute": rate,
        "temperature_rolling_z": z_score,
        "temperature_flatline_seconds": max(0, flatline_seconds - 240),
    }
    oldest = _minutes(prior[0].get("recorded_at") or prior[0].get("timestamp"))
    ready = len(temperatures) >= 5 and (now is None or oldest is not None and (now - oldest) * 60 >= 300)
    return features, ready


def _normal_sequences(seed, run_count=80, length=160):
    rng = random.Random(seed)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for _ in range(run_count):
        history = []
        for index in range(length):
            legs = len(ROUTE) - 1
            cycle_position = index % (legs * 20)
            position = cycle_position if cycle_position <= legs * 10 else legs * 20 - cycle_position
            leg_index = min(int(position // 10), legs - 1)
            fraction = (position - leg_index * 10) / 10
            lat = ROUTE[leg_index][0] + (ROUTE[leg_index + 1][0] - ROUTE[leg_index][0]) * fraction
            lon = ROUTE[leg_index][1] + (ROUTE[leg_index + 1][1] - ROUTE[leg_index][1]) * fraction
            reading = {"temperature": round(rng.uniform(2, 8), 2),
                       "humidity": round(rng.uniform(45, 75), 2),
                       "latitude": lat, "longitude": lon,
                       "recorded_at": (start + timedelta(minutes=index)).isoformat()}
            yield reading, history
            history.append(reading)


def _percentile(values, probability):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, math.ceil(probability * len(ordered)) - 1))]


def fit_normal_model():
    normal_temperatures = [reading["temperature"] for reading, _ in _normal_sequences(TRAIN_SEED)]
    normal_temperature_mean = sum(normal_temperatures) / len(normal_temperatures)
    feature_samples = {name: [] for name in FEATURE_NAMES}
    for reading, history in _normal_sequences(TRAIN_SEED):
        features, ready = extract_features(reading, history, normal_temperature_mean)
        if ready:
            for name, value in features.items():
                feature_samples[name].append(abs(value))
    scales = {name: max(_percentile(values, 0.99),
                        60.0 if name == "temperature_flatline_seconds" else 1e-6)
              for name, values in feature_samples.items()}
    return normal_temperature_mean, scales


NORMAL_TEMPERATURE_MEAN, FEATURE_SCALES = fit_normal_model()


def score_features(current, history):
    features, ready = extract_features(current, history, NORMAL_TEMPERATURE_MEAN)
    if not ready:
        return {"score": None, "features": features, "warmup_complete": False}
    normalized = {name: abs(value) / FEATURE_SCALES[name] for name, value in features.items()}
    return {"score": max(normalized.values()), "features": features,
            "normalized_features": normalized, "warmup_complete": True}


def calibrate_cutoff(seed=CALIBRATION_SEED, target_false_alarm_rate=TARGET_FALSE_ALARM_RATE):
    scores = []
    for reading, history in _normal_sequences(seed, run_count=30, length=120):
        result = score_features(reading, history)
        if result["score"] is not None:
            scores.append(result["score"])
    descending = sorted(scores, reverse=True)
    maximum_false_alarms = math.floor(len(descending) * target_false_alarm_rate)
    cutoff = math.nextafter(descending[maximum_false_alarms], math.inf)
    return cutoff, len(scores), sum(value >= cutoff for value in scores) / len(scores)


DEFAULT_CUTOFF, DEFAULT_CALIBRATION_COUNT, DEFAULT_CALIBRATION_FAR = calibrate_cutoff()
