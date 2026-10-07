import asyncio
import re
import unittest
from fastapi.testclient import TestClient

from anomaly_detection import detect_anomaly
from routes.anomaly import AnomalyRequest, TelemetryPoint, SequenceRequest, detect_telemetry_anomaly, detect_telemetry_run
from main import app


class AnomalyDetectionTests(unittest.TestCase):
    def test_http_middleware_propagates_valid_correlation_id_and_replaces_invalid_id(self):
        with TestClient(app) as client:
            response = client.get("/", headers={"X-Correlation-ID": "trace.python-11"})
            self.assertEqual(response.headers.get("x-correlation-id"), "trace.python-11")
            malformed = client.get("/", headers={"X-Correlation-ID": "not a safe id"})
            self.assertRegex(malformed.headers.get("x-correlation-id", ""), re.compile(r"^[0-9a-f-]{36}$", re.I))

    def test_stable_baseline_flags_large_temperature_change_with_reason(self):
        history = [{"temperature": value, "humidity": humidity} for value, humidity in [
            (5.0, 55), (5.1, 56), (4.9, 54), (5.0, 55), (5.1, 55), (5.0, 56),
        ]] + [{"temperature": 9.0, "humidity": 55}, {"temperature": 10.0, "humidity": 55}]
        result = detect_anomaly(12.0, 55, history)
        self.assertEqual(result["status"], "ANOMALY")
        self.assertTrue(result["advisory_only"])
        self.assertTrue(result["metrics"]["temperature"]["is_anomaly"])
        self.assertIn("prior-window median", result["reason"])
        self.assertIn("policy rules remain authoritative", " ".join(result["limitations"]).lower())

    def test_insufficient_history_is_not_reported_as_normal(self):
        result = detect_anomaly(5.0, None, [{"temperature": 5.0}] * 4)
        self.assertEqual(result["status"], "INSUFFICIENT_HISTORY")
        self.assertFalse(result["is_anomaly"])
        self.assertIn("5 prior readings are required", result["metrics"]["temperature"]["reason"])

    def test_humidity_can_be_flagged_independently(self):
        history = [{"temperature": 5, "humidity": 55 + (index % 2)} for index in range(8)]
        result = detect_anomaly(5.0, 80.0, history)
        self.assertEqual(result["status"], "NORMAL")  # Humidity metric is explanatory; calibrated detector is temperature/GPS.
        self.assertFalse(result["metrics"]["temperature"]["is_anomaly"])
        self.assertTrue(result["metrics"]["humidity"]["is_anomaly"])

    def test_timestamped_pre_limit_rise_reports_review_without_overriding_calibrated_label(self):
        history = [
            {"temperature": 6.0 + index * 0.12, "humidity": 55,
             "recorded_at": f"2026-10-04T12:0{index}:00+00:00"}
            for index in range(6)
        ]
        result = detect_anomaly(6.72, 55, history, "2026-10-04T12:06:00+00:00", 2, 8)

        self.assertEqual(result["status"], "NORMAL")
        self.assertFalse(result["metrics"]["temperature"]["is_anomaly"])
        self.assertEqual(result["trend"]["status"], "PROJECTED_LIMIT_CROSSING")
        self.assertAlmostEqual(result["trend"]["slope_c_per_minute"], 0.12, places=6)
        self.assertIn("within the configured 2–8°C range", result["reason"])
        self.assertIn("crossing 8°C", result["reason"])
        self.assertIn("human review", " ".join(result["limitations"]).lower())

    def test_http_route_payload_is_labeled_advisory_and_scoped(self):
        request = AnomalyRequest(
            temperature=12,
            humidity=55,
            batch_id="DEMO-BATCH",
            device_id="DEMO-SENSOR",
            history=[TelemetryPoint(temperature=5, humidity=55)] * 6
                    + [TelemetryPoint(temperature=9, humidity=55), TelemetryPoint(temperature=10, humidity=55)],
        )
        result = asyncio.run(detect_telemetry_anomaly(request))
        self.assertEqual(result["status"], "ANOMALY")
        self.assertEqual(result["stream"], {"batch_id": "DEMO-BATCH", "device_id": "DEMO-SENSOR"})

    def test_http_route_uses_policy_limits_for_trend_projection(self):
        request = AnomalyRequest(
            temperature=6.72, humidity=55,
            current_timestamp="2026-10-04T12:06:00Z",
            policy_minimum_temperature=2, policy_maximum_temperature=8,
            history=[TelemetryPoint(temperature=6 + index * 0.12, humidity=55,
                                    recorded_at=f"2026-10-04T12:0{index}:00Z") for index in range(6)],
        )
        result = asyncio.run(detect_telemetry_anomaly(request))
        self.assertEqual(result["trend"]["status"], "PROJECTED_LIMIT_CROSSING")
        self.assertIn("crossing 8°C", result["reason"])

    def test_advisory_model_flags_gps_jump_and_flatline_features(self):
        history = [{"temperature": 5.0 + (index % 2) * 0.1, "humidity": 60,
                    "latitude": 9.9312 + index * 0.0001, "longitude": 76.2673,
                    "recorded_at": f"2026-10-04T12:{index:02d}:00+00:00"} for index in range(8)]
        gps = detect_anomaly(5.1, 60, history, "2026-10-04T12:08:00+00:00", latitude=10.8, longitude=75.4)
        # Physical GPS plausibility is immediate, not learned or debounced.
        self.assertTrue(gps["raw_is_anomaly"])
        self.assertTrue(gps["is_anomaly"])
        self.assertGreater(gps["gps_plausibility"]["implied_speed_kmh"], 120)
        flatline_history = [{"temperature": 5, "humidity": 60, "recorded_at": f"2026-10-04T12:{index:02d}:00+00:00"} for index in range(8)]
        flatline = detect_anomaly(5, 60, flatline_history, "2026-10-04T12:08:00+00:00")
        self.assertTrue(flatline["is_anomaly"])
        self.assertGreaterEqual(flatline["detector_features"]["temperature_flatline_seconds"], 180)
        self.assertIn("temperature_rate_c_per_minute", flatline["detector_features"])

    def test_anomaly_endpoint_is_registered_on_the_active_fastapi_app(self):
        self.assertIn("/anomaly/detect", app.openapi()["paths"])

    def test_batch_run_endpoint_scores_samples_in_order_with_warmup(self):
        readings = [AnomalyRequest(temperature=5 + (index % 2) * 0.1, humidity=60,
            current_timestamp=f"2026-10-04T12:{index:02d}:00+00:00", latitude=9.93 + index * 0.001,
            longitude=76.26) for index in range(8)]
        result = asyncio.run(detect_telemetry_run(SequenceRequest(readings=readings, detector_cutoff=999)))
        self.assertEqual(len(result["readings"]), 8)
        self.assertEqual(result["readings"][0]["detector_score"], None)
        self.assertTrue(result["advisory_only"])


if __name__ == "__main__":
    unittest.main()
