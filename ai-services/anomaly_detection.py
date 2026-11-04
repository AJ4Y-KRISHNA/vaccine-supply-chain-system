"""Explainable rolling-baseline anomaly detection for synthetic telemetry."""
import math
import statistics
from datetime import datetime
from normal_detector import DEFAULT_CUTOFF, DEFAULT_CALIBRATION_COUNT, DEFAULT_CALIBRATION_FAR, FEATURE_SCALES, score_features, gps_plausibility


MINIMUM_HISTORY = 5
TEMPERATURE_FLOOR_C = 2.0
HUMIDITY_FLOOR_PERCENT = 10.0
ROBUST_Z_THRESHOLD = 3.5
TREND_WINDOW_SIZE = 12
DEFAULT_TREND_HORIZON_MINUTES = 15


def _timestamp_minutes(value):
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return None
        return parsed.timestamp() / 60
    except (ValueError, OverflowError):
        return None


def _temperature_trend(current_temperature, history, current_timestamp, minimum, maximum, horizon_minutes):
    points = []
    current_minute = _timestamp_minutes(current_timestamp)
    for row in history:
        minute = _timestamp_minutes(row.get("recorded_at") or row.get("timestamp"))
        value = row.get("temperature")
        if minute is not None and current_minute is not None and 0 < current_minute - minute <= 12 and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            points.append((minute, float(value)))
    now = _timestamp_minutes(current_timestamp)
    result = {"status": "NOT_EVALUATED", "slope_c_per_minute": None,
              "projected_temperature_c": None, "horizon_minutes": horizon_minutes,
              "reason": "Temperature trend projection needs timestamped history and configured policy limits."}
    if now is None or len(points) < MINIMUM_HISTORY or not isinstance(minimum, (int, float)) or not isinstance(maximum, (int, float)):
        return result
    if not math.isfinite(minimum) or not math.isfinite(maximum) or minimum >= maximum:
        return result
    # Ignore duplicate/out-of-order samples and only fit a forward-moving window.
    points = [(minute, value) for minute, value in points if minute < now]
    if len(points) < MINIMUM_HISTORY:
        return result
    points.append((now, float(current_temperature)))
    origin = points[0][0]
    xs = [minute - origin for minute, _ in points]
    ys = [value for _, value in points]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    variance_x = sum((x - mean_x) ** 2 for x in xs)
    if variance_x <= 1e-12:
        return result
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / variance_x
    projected = float(current_temperature) + slope * horizon_minutes
    result.update({"slope_c_per_minute": slope, "projected_temperature_c": projected})
    crosses_high = slope > 0 and minimum <= current_temperature <= maximum and projected >= maximum
    crosses_low = slope < 0 and minimum <= current_temperature <= maximum and projected <= minimum
    if not (crosses_high or crosses_low):
        result.update({"status": "NO_PROJECTED_CROSSING",
                       "reason": f"The timestamped linear trend projects {projected:.3g}°C in {horizon_minutes:g} minutes, within the configured {minimum:g}–{maximum:g}°C range."})
        return result
    boundary = maximum if crosses_high else minimum
    direction = "rising" if crosses_high else "falling"
    minutes_to_cross = (boundary - float(current_temperature)) / slope
    result.update({"status": "PROJECTED_LIMIT_CROSSING", "boundary_c": boundary,
                   "minutes_to_cross": minutes_to_cross,
                   "reason": (f"Temperature is {direction} at {slope:+.3g}°C/min; the current {float(current_temperature):.3g}°C reading is within the configured {minimum:g}–{maximum:g}°C range, "
                              f"but the timestamped linear trend projects crossing {boundary:g}°C in about {minutes_to_cross:.1f} minutes (within the {horizon_minutes:g}-minute review horizon).")})
    return result


def _metric_result(name, current, history, unit, absolute_floor):
    values = [float(value) for value in history if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)]
    if len(values) < MINIMUM_HISTORY:
        return {
            "status": "INSUFFICIENT_HISTORY",
            "is_anomaly": False,
            "sample_count": len(values),
            "reason": f"Not evaluated for {name}: {MINIMUM_HISTORY} prior readings are required; {len(values)} were available.",
        }

    median = statistics.median(values)
    mad = statistics.median([abs(value - median) for value in values])
    # 1.4826 makes MAD comparable to standard deviation for normally
    # distributed samples; the absolute floor prevents zero-variance histories
    # from treating sensor rounding noise as an anomaly.
    robust_scale = 1.4826 * mad
    if robust_scale <= 1e-12:
        robust_scale = statistics.pstdev(values)
    threshold = max(absolute_floor, ROBUST_Z_THRESHOLD * robust_scale)
    deviation = abs(float(current) - median)
    is_anomaly = deviation > threshold
    direction = "above" if current > median else "below"
    if is_anomaly:
        reason = (f"{name.capitalize()} is {deviation:.3g}{unit} {direction} the prior-window median "
                  f"of {median:.3g}{unit}, exceeding the {threshold:.3g}{unit} rolling-baseline threshold "
                  f"({len(values)} prior readings; robust z threshold {ROBUST_Z_THRESHOLD:g}).")
    else:
        reason = (f"{name.capitalize()} is within the rolling-baseline threshold: {float(current):.3g}{unit} "
                  f"versus prior-window median {median:.3g}{unit} (threshold {threshold:.3g}{unit}; {len(values)} readings).")
    return {
        "status": "ANOMALY" if is_anomaly else "NORMAL",
        "is_anomaly": is_anomaly,
        "current": float(current),
        "baseline_median": median,
        "absolute_deviation": deviation,
        "threshold": threshold,
        "robust_z_score": deviation / robust_scale if robust_scale > 0 else None,
        "sample_count": len(values),
        "reason": reason,
    }


def detect_anomaly(current_temperature, current_humidity, history, current_timestamp=None,
                   policy_minimum_temperature=None, policy_maximum_temperature=None,
                   trend_horizon_minutes=DEFAULT_TREND_HORIZON_MINUTES,
                   latitude=None, longitude=None, score_cutoff=None):
    """Compare a reading with its preceding rolling window; never sets a safety hold."""
    temperatures = [row.get("temperature") for row in history]
    results = {
        "temperature": _metric_result("temperature", current_temperature, temperatures, "°C", TEMPERATURE_FLOOR_C),
    }
    if current_humidity is not None:
        humidity = [row.get("humidity") for row in history]
        results["humidity"] = _metric_result("humidity", current_humidity, humidity, "%", HUMIDITY_FLOOR_PERCENT)

    trend = _temperature_trend(current_temperature, history, current_timestamp,
                               policy_minimum_temperature, policy_maximum_temperature, trend_horizon_minutes)
    evaluated = [result for result in results.values() if result["status"] != "INSUFFICIENT_HISTORY"]
    current = {"temperature": float(current_temperature), "recorded_at": current_timestamp,
               "latitude": latitude, "longitude": longitude}
    detector = score_features(current, history)
    cutoff = DEFAULT_CUTOFF if score_cutoff is None else float(score_cutoff)
    gps = gps_plausibility(current, history)
    statistical_raw = detector["score"] is not None and detector["score"] >= cutoff
    raw_anomaly = statistical_raw or gps["flagged"]
    # Debounce advisory positives: require at least two raw positives among
    # the current sample and its two immediate predecessors. Recompute those
    # historical scores against only their own preceding samples so the rule
    # is identical for streaming /detect and batched /detect/run callers.
    recent = []
    start = max(0, len(history) - 2)
    for index in range(start, len(history)):
        prior = history[:index]
        score = score_features(history[index], prior)["score"]
        if score is not None:
            recent.append(score >= cutoff)
    if detector["score"] is not None:
        recent.append(statistical_raw)
    persistence_window = recent[-3:]
    persistence_ready = len(persistence_window) == 3
    anomaly = gps["flagged"] or (persistence_ready and sum(persistence_window) >= 2)
    if anomaly:
        status = "ANOMALY"
        reason_parts = [result["reason"] for result in evaluated if result["is_anomaly"]]
        if gps["flagged"]:
            reason_parts.append(gps["reason"])
        if not raw_anomaly:
            reason_parts.append(f"Advisory persistence is active: {sum(persistence_window)} of the latest {len(persistence_window)} raw scores met the calibrated cutoff {cutoff:.3g}; the current raw score is below cutoff.")
        if not reason_parts:
            normalized = detector.get("normalized_features", {})
            top_feature = max(normalized, key=normalized.get) if normalized else None
            if top_feature:
                value = detector["features"][top_feature]
                reason_parts.append(f"{top_feature} was {value:.3g} (normal-scaled score {normalized[top_feature]:.3g}); combined score {detector['score']:.3g} met the calibrated cutoff {cutoff:.3g}.")
        if trend["status"] == "PROJECTED_LIMIT_CROSSING":
            reason_parts.append("Trend review: " + trend["reason"])
        reason = " ".join(reason_parts) or f"Normal-only advisory detector score {detector['score']:.3g} met its held-out normal cutoff {cutoff:.3g}."
    elif not evaluated:
        status = "INSUFFICIENT_HISTORY"
        reason = "No metric had the minimum historical sample count; no anomaly conclusion was produced."
    else:
        status = "NORMAL"
        reason = "Normal-only advisory detector score remained below its held-out normal cutoff."
        if trend["status"] == "PROJECTED_LIMIT_CROSSING":
            reason += " Trend review: " + trend["reason"]

    # Explainable additive statistical score, not a trained probability or SHAP.
    # Equal-weight normalized deviations; trend crossing contributes one unit.
    contributions = {name: min(1.0, result.get("absolute_deviation", 0) / max(result.get("threshold", 1), 1e-12))
                     for name, result in results.items()}
    contributions["temperature_trend"] = 1.0 if trend["status"] == "PROJECTED_LIMIT_CROSSING" else 0.0
    feature_contributions = {name: value / len(contributions) for name, value in contributions.items()}
    explanations = [{"feature": name, "contribution": feature_contributions[name], "text": result["reason"]}
                    for name, result in results.items()]
    now = _timestamp_minutes(current_timestamp)
    window = [row for row in history if now is not None and
              (minute := _timestamp_minutes(row.get("recorded_at") or row.get("timestamp"))) is not None
              and 0 < now - minute <= 30 and isinstance(row.get("temperature"), (int, float))
              and not isinstance(row.get("temperature"), bool) and math.isfinite(row["temperature"])]
    if window:
        mean = statistics.mean(row["temperature"] for row in window)
        explanations[0]["rolling_mean_c"] = mean
        explanations[0]["rolling_mean_sample_count"] = len(window)
        explanations[0]["text"] += f" Temperature is {float(current_temperature) - mean:+.3g}°C relative to the mean {mean:.3g}°C of {len(window)} available samples in the preceding 30 minutes."
    slope_text = f" Observed temperature slope: {trend['slope_c_per_minute']:+.3g}°C/min." if trend["slope_c_per_minute"] is not None else ""
    explanations.append({"feature": "temperature_trend", "contribution": feature_contributions["temperature_trend"],
                         "slope_c_per_minute": trend["slope_c_per_minute"], "text": trend["reason"] + slope_text})
    return {
        "status": status,
        "label": status,
        "contributions": explanations,
        "score": sum(feature_contributions.values()) if evaluated else None,
        "detector_score": detector["score"],
        "ranking_score": max(detector["score"] or 0, (gps["implied_speed_kmh"] or 0) / gps["max_speed_kmh"] * cutoff),
        "gps_plausibility": gps,
        "detector_cutoff": cutoff,
        "detector_features": detector["features"],
        "detector_feature_contributions": [
            {"feature": name, "value": value, "normal_scaled_magnitude": detector.get("normalized_features", {}).get(name),
             "text": f"{name.replace('_', ' ')} = {value:.3g}; absolute magnitude is {detector.get('normalized_features', {}).get(name, 0):.3g} times its normal-only scale."}
            for name, value in detector["features"].items()
        ],
        "detector_warmup_complete": detector["warmup_complete"],
        "calibration": {"method": "normal-only synthetic training plus separate held-out normal calibration",
                        "training_seed": 90210, "calibration_seed": 90211,
                        "calibration_samples": DEFAULT_CALIBRATION_COUNT,
                        "target_false_alarm_rate": 0.01,
                        "observed_calibration_false_alarm_rate": DEFAULT_CALIBRATION_FAR,
                        "feature_scales": FEATURE_SCALES},
        "feature_contributions": feature_contributions,
        "score_basis": "Equal-weight normalized baseline deviations plus projected boundary crossing; not a safety probability.",
        "is_anomaly": anomaly,
        "raw_is_anomaly": raw_anomaly,
        "persistence": {"method": "k_of_n", "k": 2, "n": 3,
                        "ready": persistence_ready,
                        "raw_positive_count": sum(persistence_window),
                        "available_samples": len(persistence_window)},
        "model": "normal_only_multifeature_advisory_v3",
        "model_version": "time-normalized-temperature-physical-gps-v3",
        "advisory_only": True,
        "history_count": len(history),
        "metrics": results,
        "trend": trend,
        "reason": reason,
        "limitations": [
            "The calibrated learned score uses temperature features only; humidity is an explanatory rolling-baseline metric, and GPS is a separate physical rule.",
            "Timestamped temperature scoring needs five minutes of warm-up and at least five prior fixes; untimestamped compatibility input cannot establish rates or flatline duration.",
            "A local statistical deviation is not a vaccine safety determination.",
            "The detector uses prior readings for one device and batch; it is not trained on labeled failures.",
            "The linear temperature trend is a short-horizon statistical projection for human review, not a prediction of product safety.",
            "Approved cold-chain policy rules remain authoritative for alerts and quarantine.",
        ],
    }
