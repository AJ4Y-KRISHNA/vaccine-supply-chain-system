from normal_detector import (CALIBRATION_SEED, DEFAULT_CALIBRATION_COUNT,
                             DEFAULT_CALIBRATION_FAR, DEFAULT_CUTOFF,
                             FEATURE_SCALES, TRAIN_SEED, score_features)
from anomaly_detection import detect_anomaly


def test_advisory_detector_is_fit_on_normal_only_and_calibrated_below_one_percent_far():
    assert TRAIN_SEED != CALIBRATION_SEED
    assert DEFAULT_CALIBRATION_COUNT > 1000
    assert 0 < DEFAULT_CUTOFF
    assert 0 <= DEFAULT_CALIBRATION_FAR <= 0.01
    assert set(FEATURE_SCALES) == {
        "temperature_ewma_deviation_c", "temperature_rate_c_per_minute",
        "temperature_rolling_z", "temperature_flatline_seconds",
    }


def test_warmup_is_reported_without_fabricating_an_anomaly_score():
    result = score_features({"temperature": 5, "recorded_at": "2026-10-04T12:00:00Z"}, [])
    assert result["warmup_complete"] is False
    assert result["score"] is None


def test_normal_only_ewma_reference_keeps_persistent_warm_excursion_visible():
    history = [{"temperature": 5.0 + (index % 2) * 0.1,
                "recorded_at": f"2026-10-04T12:{index:02d}:00Z"} for index in range(12)]
    current = {"temperature": 10.5, "recorded_at": "2026-10-04T12:12:00Z"}
    result = score_features(current, history)
    assert result["features"]["temperature_ewma_deviation_c"] > 1
    assert result["score"] > DEFAULT_CUTOFF


def test_ai_advisory_requires_two_of_three_raw_positives(monkeypatch):
    def controlled_score(current, history):
        positive = current["temperature"] >= 8
        return {"score": 1.0 if positive else 0.0,
                "features": {"temperature_rate_c_per_minute": 1.0 if positive else 0.0},
                "normalized_features": {"temperature_rate_c_per_minute": 1.0 if positive else 0.0},
                "warmup_complete": True}

    monkeypatch.setattr("anomaly_detection.score_features", controlled_score)
    history = [{"temperature": 9.0}, {"temperature": 9.0}]
    persisted = detect_anomaly(5.0, None, history, score_cutoff=0.5)
    assert persisted["raw_is_anomaly"] is False
    assert persisted["is_anomaly"] is True
    assert persisted["persistence"] == {"method": "k_of_n", "k": 2, "n": 3,
                                         "ready": True, "raw_positive_count": 2,
                                         "available_samples": 3}


def test_ai_advisory_keeps_single_raw_positive_as_non_anomaly(monkeypatch):
    monkeypatch.setattr("anomaly_detection.score_features", lambda current, history: {
        "score": 1.0 if current["temperature"] >= 8 else 0.0,
        "features": {}, "normalized_features": {}, "warmup_complete": True,
    })
    result = detect_anomaly(9.0, None, [{"temperature": 5.0}, {"temperature": 5.0}], score_cutoff=0.5)
    assert result["raw_is_anomaly"] is True
    assert result["is_anomaly"] is False
    assert result["persistence"]["raw_positive_count"] == 1


def test_physical_gps_rule_is_not_learned_or_debounced():
    from normal_detector import gps_plausibility
    prior = {"temperature": 5, "latitude": 10, "longitude": 76, "recorded_at": "2026-01-01T00:00:00Z"}
    current = {**prior, "latitude": 11, "recorded_at": "2026-01-01T00:01:00Z"}
    gps = gps_plausibility(current, [prior])
    assert gps["flagged"] and gps["implied_speed_kmh"] > 6000
    assert "km/h" in gps["reason"]
    result = detect_anomaly(5, None, [prior], current["recorded_at"], latitude=11, longitude=76)
    assert result["is_anomaly"] and result["raw_is_anomaly"]
    assert "GPS implies" in result["reason"]
    assert not gps_plausibility(prior, [prior])["flagged"]


def test_time_normalization_has_fixed_physical_horizons():
    from normal_detector import extract_features
    from datetime import datetime, timedelta, timezone
    origin = datetime(2026, 1, 1, tzinfo=timezone.utc)
    def feature(interval):
        points = [{"temperature": 5, "recorded_at": (origin + timedelta(seconds=t)).isoformat()}
                  for t in range(0, 601, interval)]
        points[-1]["temperature"] = 10
        return extract_features(points[-1], points[:-1])[0]
    assert feature(10)["temperature_ewma_deviation_c"] < feature(60)["temperature_ewma_deviation_c"]
    # Same unchanging 10-minute signal has the same duration at both cadences.
    for interval in (10, 60):
        points = [{"temperature": 5, "recorded_at": (origin + timedelta(seconds=t)).isoformat()}
                  for t in range(0, 601, interval)]
        assert extract_features(points[-1], points[:-1])[0]["temperature_flatline_seconds"] == 360
