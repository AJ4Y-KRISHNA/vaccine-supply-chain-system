from unittest.mock import patch
import pytest
from forecasting.regional import forecast_regional, metrics
from forecasting.allocation import optimize
from anomaly_detection import detect_anomaly


def test_anomaly_numeric_plain_english_preserves_authority():
    history = [{"temperature": 5 + i * .1, "humidity": 60,
                "recorded_at": f"2026-10-06T10:{i:02d}:00Z"} for i in range(6)]
    history += [
        {"temperature": 8.8, "humidity": 60, "recorded_at": "2026-10-06T10:06:00Z"},
        {"temperature": 9.0, "humidity": 60, "recorded_at": "2026-10-06T10:07:00Z"},
    ]
    result = detect_anomaly(9.3, 61, history, "2026-10-06T10:08:00Z", 2, 8)
    assert result["label"] == "ANOMALY" and result["advisory_only"]
    assert all("text" in row and isinstance(row["contribution"], float) for row in result["contributions"])
    assert "30 minutes" in result["contributions"][0]["text"]
    assert "°C/min" in result["contributions"][-1]["text"]
    assert "quarantine" not in result


def test_forecast_real_sarima_comparison_and_intervals():
    values = [100 + (i % 12) * 3 + i for i in range(36)]
    result = forecast_regional(values, 6, "2026-09")
    assert result["forecast_periods"][0]["period"] == "2026-10"
    assert len(result["forecast_periods"]) == 6
    assert any(row["model"].startswith("SARIMA") and row["status"] == "evaluated" for row in result["comparison"])
    assert all(0 <= row["lower"] <= row["demand_doses"] <= row["upper"] for row in result["forecast_periods"])
    assert result["synthetic"] and result["training_months"] == 30


def test_sarima_failure_uses_disclosed_seasonal_fallback():
    with patch("forecasting.regional.fit_sarima", side_effect=ValueError("nonconvergence")):
        result = forecast_regional([100] * 36, 3, "2026-09")
    assert result["model"] == "seasonal_naive_12"
    assert result["comparison"][-1]["status"] == "unavailable"
    assert result["forecast_periods"][0]["demand_doses"] == 100


def test_invalid_forecasts_and_zero_mape():
    for values in ([1] * 29, [float("nan")] * 36, [-1] * 36):
        with pytest.raises(ValueError): forecast_regional(values, 3, "2026-09")
    with pytest.raises(ValueError): forecast_regional([1] * 36, 2, "2026-09")
    assert metrics([0, 10], [1, 12])["mape"] == 20
    assert metrics([0], [1])["mape"] is None


def stock(product, quantity):
    return {"batchId": product, "vaccineType": product, "remainingDoses": quantity}


def target(product, region="R"):
    return {"vaccineType": product, "region": region, "doses": 100, "capacity": 120}


def test_lp_shared_region_and_transport_capacity():
    result = optimize([stock("A", 90), stock("B", 80)], [target("A"), target("B")], 150)
    assert result["allocatedDoses"] == 120
    assert result["method"].startswith("scipy")
    assert sum(row["doses"] for row in result["unfilled"]) == 80
    assert optimize([stock("A", 90)], [target("A")], 30)["allocatedDoses"] == 30


def test_solver_failure_greedy_and_empty_stock():
    with patch("forecasting.allocation.linprog", side_effect=RuntimeError("test solver failure")):
        result = optimize([stock("A", 50)], [target("A")], 200)
    assert result["method"] == "greedy_fallback" and result["allocatedDoses"] == 50
    assert optimize([], [target("A")], 100)["allocatedDoses"] == 0
    with pytest.raises(ValueError): optimize([stock("A", -1)], [target("A")], 100)
