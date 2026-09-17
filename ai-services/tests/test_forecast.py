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

if __name__ == "__main__": unittest.main()
