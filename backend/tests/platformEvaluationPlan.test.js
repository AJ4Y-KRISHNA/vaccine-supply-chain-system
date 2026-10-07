const { scenarioPlan, scenarioClock } = require("../services/platformEvaluationPlan");
const { VirtualDeviceSimulator } = require("../services/iotSimulator");

test("platform drift smoke run lasts long enough to exercise an actual policy breach", () => {
  const item = scenarioPlan.find(row => row.name === "compressor_drift");
  const now = Date.parse("2026-10-07T12:00:00Z");
  const clock = scenarioClock(item, now);
  const simulator = new VirtualDeviceSimulator({ deviceId: "SYNTHETIC-PLAN-TEST", vehicleId: "SYNTHETIC",
    batchId: "SYNTHETIC", scenario: item.profile, seed: "platform-plan-unit-not-calibration", ...clock,
    temperatureRange: { min: 2, max: 8 } });
  const rows = Array.from({ length: item.ticks }, () => simulator.tick());
  expect(rows.some(row => row.temperature > 8)).toBe(true);
  expect(Date.parse(rows.at(-1).timestamp)).toBeLessThan(now);
  expect(clock.maximumReadingGapMs).toBeGreaterThan(clock.tickIntervalMs);
});

test("all platform horizons are past, within ingestion limits, and in closed buckets", () => {
  const now = Date.parse("2026-10-07T12:03:00Z");
  for (const item of scenarioPlan) {
    const clock = scenarioClock(item, now), first = Date.parse(clock.startTime);
    const last = first + (item.ticks - 1) * clock.tickIntervalMs;
    expect(first).toBeGreaterThan(now - 86400000);
    expect(last).toBeLessThan(now - 300000);
  }
});
