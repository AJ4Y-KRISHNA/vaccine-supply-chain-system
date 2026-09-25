import asyncio
import os
import unittest
from unittest.mock import patch
from forecasting.baselines import forecast, predict
from ingestion.demand_dataset import load_dataset
from routes.forecast import forecast_demand, ForecastRequest

class BaselineTests(unittest.TestCase):
    def test_reproducible_and_latest_window(self):
        values = list(range(10, 58))
        self.assertEqual(forecast(values), forecast(values))
        self.assertEqual(forecast(values)["predicted_demand"], 58)
        self.assertEqual(predict([1, 2, 3, 40], "mean_3"), 15)

    def test_future_changes_do_not_change_prefix_selection(self):
        values = list(range(48))
        changed = values[:36] + [1000] * 12
        a, b = forecast(values), forecast(changed)
        self.assertEqual(a["model"], b["model"])
        self.assertEqual(a["validation"]["selection"], b["validation"]["selection"])
        self.assertNotEqual(a["validation"]["selected_metrics"], b["validation"]["selected_metrics"])

    def test_invalid_and_zero_series(self):
        for values in [[], [1] * 5, [1] * 241, [float("nan")] * 6, [-1] * 6, [True] * 6]:
            with self.assertRaises(ValueError): forecast(values)
        result = forecast([0] * 12)
        self.assertEqual(result["predicted_demand"], 0)
        self.assertIsNone(result["validation"]["selected_metrics"]["wape"])

    @patch.dict(os.environ, {}, clear=True)
    def test_demo_provenance_and_path_allowlist(self):
        values, source = load_dataset()
        self.assertTrue(source["synthetic"])
        with self.assertRaises(ValueError): load_dataset("../../secret.csv")
        result = asyncio.run(forecast_demand(ForecastRequest()))
        self.assertTrue(result["provenance"]["synthetic"])
        self.assertEqual(result["predicted_demand"], forecast(values)["predicted_demand"])

    def test_all_baselines_use_same_holdout(self):
        result = forecast([10 + (i * 7) % 19 for i in range(48)])
        self.assertEqual({m["observations"] for m in result["validation"]["comparison"].values()}, {12})

    def test_explanation_breakdown_is_explicit_and_rules_based(self):
        result = forecast([10, 12, 11, 14, 15, 18, 20, 22])
        explanation = result["explanation_breakdown"]
        self.assertEqual(explanation["version"], "heuristic-baseline-explanation-v1")
        self.assertIn(explanation["selected_baseline"], ("naive", "mean_3", "drift"))
        self.assertTrue(explanation["calculation"])
        self.assertTrue(explanation["inputs"])
        self.assertIn("recent_volume_trend", explanation)
        self.assertFalse(explanation["seasonality"]["modeled"])
        self.assertIn("not SHAP, LIME", explanation["methodology"])

    def test_forecast_endpoint_accepts_optional_supply_context(self):
        response = asyncio.run(forecast_demand(ForecastRequest(
            vaccination_data=[10, 12, 11, 14, 15, 18],
            supply_context={
                "status": "available", "scope": "single vaccine type", "vaccine_type": "Demo",
                "total_unallocated_stock_doses": 50, "current_available_stock_doses": 40,
                "active_quarantine_batch_count": 1, "quarantined_unallocated_doses": 10,
                "unavailable_unallocated_stock_doses": 10,
            },
        )))
        self.assertEqual(response["explanation_breakdown"]["supply_context"]["current_available_stock_doses"], 40)

    def test_active_quarantine_changes_supply_explanation_not_demand_number(self):
        values = [10, 12, 11, 14, 15, 18, 20, 22]
        normal_context = {
            "status": "available", "scope": "single vaccine type", "vaccine_type": "Demo",
            "total_unallocated_stock_doses": 100, "current_available_stock_doses": 100,
            "active_quarantine_batch_count": 0, "quarantined_unallocated_doses": 0,
            "unavailable_unallocated_stock_doses": 0, "captured_at": "2026-01-01T00:00:00Z",
        }
        held_context = {
            **normal_context, "current_available_stock_doses": 70,
            "active_quarantine_batch_count": 1, "quarantined_unallocated_doses": 30,
            "unavailable_unallocated_stock_doses": 30,
        }
        normal = forecast(values, supply_context=normal_context)
        held = forecast(values, supply_context=held_context)
        normal_supply = normal["explanation_breakdown"]["supply_context"]
        held_supply = held["explanation_breakdown"]["supply_context"]
        self.assertEqual(normal["predicted_demand"], held["predicted_demand"])
        self.assertEqual(held_supply["active_quarantine_batch_count"], 1)
        self.assertEqual(held_supply["current_available_stock_doses"], 70)
        self.assertEqual(held_supply["quarantined_unallocated_doses"], 30)
        self.assertIn("30 unallocated dose(s)", held_supply["quarantine_description"])
        self.assertNotEqual(normal_supply["quarantine_description"], held_supply["quarantine_description"])
        self.assertFalse(held_supply["used_to_change_predicted_demand"])

if __name__ == "__main__": unittest.main()
