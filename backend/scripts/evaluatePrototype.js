// Synthetic regression evaluation only; creates/drops only its isolated test DB.
const assert = require("node:assert/strict");
const db = require("../tests/helpers/coldChainFixture");
const { persistSimulationReading } = require("../services/telemetryService");
const { checkMissingTelemetry } = require("../services/temperatureAlertService");
const Alert = require("../models/TemperatureAlert");
const cases = [
  { name: "normal", temperatures: [5, 5, 5], alert: false, hold: false },
  { name: "sustained-high", temperatures: [10, 10, 10], alert: true, hold: true },
  { name: "sustained-low", temperatures: [0, 0, 0], alert: true, hold: true },
  { name: "brief-high", temperatures: [10, 5, 5], alert: true, hold: false },
  { name: "humidity", temperatures: [5, 5, 5], extra: { humidity: 90 }, alert: true, hold: false },
  { name: "battery", temperatures: [5, 5, 5], extra: { batteryLevel: 2 }, alert: true, hold: false },
  { name: "complete-silence", temperatures: [5], missingAt: 5, alert: true, hold: false },
  { name: "unobserved-gap", temperatures: [10, 10, 10], minutes: [0, 4, 5], alert: true, hold: false },
];
async function main() {
  await db.connect();
  const outcomes = [], confusion = { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 };
  for (const scenario of cases) {
    const f = await db.fixture();
    for (let i = 0; i < scenario.temperatures.length; i++) await persistSimulationReading(f.reading(scenario.temperatures[i], scenario.minutes?.[i] ?? i, scenario.extra));
    if (scenario.missingAt) await checkMissingTelemetry(f.batchId, f.at(scenario.missingAt));
    const events = await Alert.find({ batchId: f.batchId }).lean();
    const held = events.some(event => event.requiresQualityReview), any = events.length > 0;
    assert.equal(any, scenario.alert, scenario.name); assert.equal(held, scenario.hold, scenario.name);
    confusion[held ? scenario.hold ? "truePositive" : "falsePositive" : scenario.hold ? "falseNegative" : "trueNegative"]++;
    outcomes.push({ scenario: scenario.name, expectedAlert: scenario.alert, observedAlert: any, expectedHold: scenario.hold, observedHold: held,
      explanationsPresent: events.every(event => event.reasons.length && event.recommendedAction && event.confidence?.basis),
      detectionSimulationMs: held ? events.find(event => event.requiresQualityReview).excursionDurationMs : null });
  }
  const f = await db.fixture(), latencies = [], start = performance.now();
  for (let i = 0; i < 100; i++) {
    const tickStart = performance.now();
    const row = await persistSimulationReading(f.reading(5, i));
    assert.equal(row.evaluation.severity, "NORMAL"); latencies.push(performance.now() - tickStart);
  }
  const elapsed = performance.now() - start;
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ scope: "synthetic fixture regression, NOT clinical sensitivity/specificity or independent research validation",
    policy: "synthetic 2–8 C, 2 minute excursion, 90 second maximum gap", outcomes, quarantineConfusion: confusion,
    explanationCoverage: outcomes.filter(o => o.observedAlert && o.explanationsPresent).length + "/" + outcomes.filter(o => o.observedAlert).length,
    sequentialLocalPersistence: { readings: 100, elapsedMs: Math.round(elapsed), readingsPerSecond: Number((100000 / elapsed).toFixed(2)),
      medianMs: Number(latencies[50].toFixed(2)), p95Ms: Number(latencies[94].toFixed(2)) },
    limitations: ["Hand-constructed cases exercise the same written rules; no independent ground truth", "Only two positive quarantine cases", "Single local process/DB, warm sequential writes, no concurrent load", "Timing varies by machine; do not generalize throughput"] }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(db.close);
