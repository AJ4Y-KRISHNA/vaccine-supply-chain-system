from anomaly_detection import detect_anomaly


def test_contributions_are_additive_and_advisory():
    result = detect_anomaly(12, 90, [{"temperature": 5, "humidity": 60}] * 8)
    assert result["advisory_only"] is True
    assert 0 <= result["score"] <= 1
    assert result["score"] == sum(result["feature_contributions"].values())
    assert set(result["feature_contributions"]) == {"temperature", "humidity", "temperature_trend"}
    assert "not a safety probability" in result["score_basis"]


def test_insufficient_history_does_not_fabricate_a_score():
    result = detect_anomaly(5, 60, [])
    assert result["score"] is None
    assert not result["is_anomaly"]
