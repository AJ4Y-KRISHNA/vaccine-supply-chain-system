// Compose-backed evaluation using only labelled synthetic profiles and records.
// This is a local demonstration harness, not a clinical or production benchmark.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const { confusion, quantile } = require("../services/evaluationMetrics");
const { scenarioPlan, scenarioClock } = require("../services/platformEvaluationPlan");
async function until(read, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await wait(250); }
  return null;
}
async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const Batch = require("../models/Batch"), Policy = require("../models/ColdChainPolicy"), User = require("../models/user");
  const Shipment = require("../models/Shipment"), Log = require("../models/TemperatureLog"), Alert = require("../models/TemperatureAlert");
  const Notification = require("../models/Notification"), Window = require("../models/MerkleWindow");
  const Receipt = require("../models/EventReceipt"), Queue = require("../models/EdgeGatewayQueue");
  const admin = await User.findOne({ email: "admin@demo.synthetic.test", role: "admin", canReviewColdChain: true }).lean();
  if (!admin || !process.env.DEMO_SEED_PASSWORD) throw new Error("Synthetic reviewer seed is missing; run scripts/seed.js");
  const api = `http://127.0.0.1:${process.env.PORT || 5000}/api`;
  const call = async (method, route, token, body, headers = {}) => {
    const response = await fetch(api + route, { method, headers: { "content-type": "application/json", ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${route} ${response.status}: ${JSON.stringify(payload)}`);
    return payload;
  };
  const login = await call("POST", "/auth/login", null, { email: admin.email, password: process.env.DEMO_SEED_PASSWORD, role: "admin" });
  const token = login.token;
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const metrics = { generatedAt: new Date().toISOString(), synthetic: true, clinicalUse: false,
    limitations: ["Single local Compose run; not a production benchmark", "Scenario labels represent simulator intent, not independently measured ground truth", "Failure isolation is a consumer-handler probe; dependency containers are not stopped", "Synthetic simulator timestamps are accelerated/backfilled and are not field latency"],
    scenarios: {}, latency: {}, throughput: {}, offlineRecovery: {}, failureIsolation: {}, blockchain: {}, forecast: {} };
  const scenarioResults = [];
  const scenarioArtifacts = [];
  for (const item of scenarioPlan) {
    const clock = scenarioClock(item);
    const id = `SYNTHETIC-PHASE7-EVAL-${item.name}-${suffix}`;
    const deviceId = `SYNTHETIC-EVAL-${item.name}-${suffix}`;
    const shipmentId = `SYNTHETIC-EVAL-SHIP-${item.name}-${suffix}`;
    const vaccineType = `SYNTHETIC EVALUATION ${item.name} — NOT CLINICAL`;
    const batch = await Batch.create({ batchId: id, vaccineType, quantity: 100, manufacturer: "Synthetic Demo Manufacturer", status: "Ready", isDemo: true,
      demoProvenance: { source: "phase-7-evaluation", nature: "synthetic", clinicalUse: false } });
    await Shipment.create({ shipmentId, batchId: id, vehicleId: deviceId, routeId: "KOCHI-SYNTHETIC-ROUTE", vaccineType,
      quantity: 100, distributor: "Synthetic Demo Distributor", destination: "Synthetic Demo Hospital", status: "In Transit", isDemo: true });
    const policy = await Policy.create({ batchId: id, vaccineType, minimumTemperature: 2, maximumTemperature: 8,
      minimumHumidity: 0, maximumHumidity: 100, excursionDurationMs: 5000, maximumReadingGapMs: clock.maximumReadingGapMs,
      criticalBatteryPercent: 10, maximumRateCelsiusPerMinute: 100, sourceReference: "Synthetic evaluator fixture",
      approvalReason: "Synthetic policy for evaluation only", approvedBy: admin._id });
    batch.coldChainPolicyId = policy._id; await batch.save();
    const chain = require("../services/blockchainService"); await chain.registerBatchOnChain(id, vaccineType, 100);
    // Backfill the whole scenario horizon into closed Merkle buckets.
    const { startTime, tickIntervalMs } = clock;
    await call("POST", "/simulator/devices", token, { deviceId, vehicleId: deviceId, batchId: id, shipmentId,
      scenario: item.profile, seed: `eval-${suffix}-${item.name}`, startTime, tickIntervalMs, temperatureRange: { min: 2, max: 8 } });
    const sensorStartWall = Date.now();
    for (let tick = 0; tick < item.ticks; tick++) await call("POST", `/simulator/${encodeURIComponent(deviceId)}/tick`, token, {});
    if (item.profile === "LINK_LOSS") {
      // The profile buffers at the gateway; switching to NORMAL and ticking
      // flushes queued samples in order. The app API uses the durable simulator.
      await call("POST", `/simulator/${encodeURIComponent(deviceId)}/scenario`, token, { scenario: "NORMAL" });
      await call("POST", `/simulator/${encodeURIComponent(deviceId)}/tick`, token, {});
    }
    const expectedSaved = item.ticks + (item.profile === "LINK_LOSS" ? 1 : 0);
    const saved = await until(async () => {
      const rows = await Log.find({ batchId: id, deviceId }).sort({ sequenceNumber: 1 }).lean();
      return rows.length >= expectedSaved ? rows : null;
    });
    if (!saved?.length) throw new Error(`${item.name}: telemetry was not persisted`);
    const eventIds = saved.map(row => row.eventId).filter(Boolean);
    const processed = await until(async () => await Receipt.countDocuments({ group: "policy-alert", eventId: { $in: eventIds } }) >= saved.length);
    if (!processed) throw new Error(`${item.name}: policy-alert consumer did not process all saved readings`);
    const alert = await Alert.findOne({ batchId: id, deviceId, metric: "TEMPERATURE" }).sort({ createdAt: 1 }).lean();
    const alertObservedWall = alert ? Date.now() : null;
    const detected = Boolean(alert);
    const scenarioScore = confusion([{ expected: item.expected, detected }]);
    metrics.scenarios[item.name] = { profile: item.profile, syntheticGroundTruth: item.expected ? "temperature excursion expected" : "no temperature excursion expected",
      readings: saved.length, detected, correct: item.expected === detected, accuracy: item.expected === detected ? 1 : 0, ...scenarioScore };
    scenarioResults.push({ expected: item.expected, detected });
    let notification = null, window = null;
    if (alert) {
      notification = await until(() => Notification.findOne({ alertId: alert.alertId, recipientRole: "admin" }).sort({ createdAt: 1 }).lean());
      if (!notification) throw new Error(`${item.name}: policy alert was not notified`);
    }
    const notificationObservedWall = notification ? Date.now() : null;
    const windows = await until(async () => {
      const confirmed = await Window.find({ batchId: id, status: "confirmed" }).sort({ confirmedAt: 1 }).lean();
      return confirmed.reduce((total, row) => total + row.count, 0) >= saved.length ? confirmed : null;
    }, 360000);
    if (!windows) throw new Error(`${item.name}: not all saved readings were anchored`);
    window = windows.at(-1);
    const chainObservedWall = Date.now();
    scenarioArtifacts.push({ item, batchId: id, deviceId, alert, notification, window, windows, saved,
      wall: { sensorStartWall, alertObservedWall, notificationObservedWall, chainObservedWall } });
  }
  metrics.scenarios.aggregate = confusion(scenarioResults);
  const latencyRows = scenarioArtifacts.filter(x => x.alert && x.notification && x.window).map(x => {
    const source = x.saved.find(row => row._id.equals(x.alert.temperatureLogId)) || x.saved[0];
    return { sensorTimestampToAlertMs: x.alert.createdAt - source.recordedAt,
      wallFromTickToAlertObservedMs: x.wall.alertObservedWall - x.wall.sensorStartWall,
      alertToNotificationMs: x.notification.createdAt - x.alert.createdAt,
      wallAlertToNotificationObservedMs: x.wall.notificationObservedWall - x.wall.alertObservedWall,
      alertToChainConfirmationMs: x.window.confirmedAt - x.alert.createdAt,
      wallAlertToChainObservedMs: x.wall.chainObservedWall - x.wall.alertObservedWall };
  });
  for (const key of ["sensorTimestampToAlertMs", "wallFromTickToAlertObservedMs", "alertToNotificationMs", "wallAlertToNotificationObservedMs", "alertToChainConfirmationMs", "wallAlertToChainObservedMs"]) {
    const values = latencyRows.map(row => row[key]); metrics.latency[key] = { samples: values.length, p50: quantile(values, .5), p95: quantile(values, .95), unit: "ms" };
  }

  // Measure accepted ingress through the authenticated telemetry HTTP endpoint.
  const perfBatch = scenarioArtifacts[0].batchId;
  for (const deviceCount of [1, 10, 50]) {
    const started = Date.now(); let accepted = 0;
    for (let index = 0; index < deviceCount; index++) {
      const deviceId = `SYNTHETIC-THROUGHPUT-${deviceCount}-${index}-${suffix}`;
      const batchReadings = Array.from({ length: 3 }, (_, seq) => ({ deviceId, batchId: perfBatch, vehicleId: deviceId,
        sequenceNumber: seq, temperature: 4.5, humidity: 55, batteryLevel: 99,
        location: { lat: 9.9312, lng: 76.2673 }, recordedAt: new Date().toISOString(),
        simulation: { source: "phase7-evaluation", scenario: "NORMAL", seed: suffix, tick: seq } }));
      const result = await call("POST", "/temperature/ingest", null, batchReadings, { "x-api-key": process.env.TEMP_API_KEY });
      accepted += Array.isArray(result) ? result.length : Number(result.accepted || result.count || (result.readings || []).length || 1);
    }
    const seconds = Math.max((Date.now() - started) / 1000, .001);
    metrics.throughput[deviceCount] = { devices: deviceCount, acceptedMessages: accepted, elapsedSeconds: seconds, messagesPerSecond: accepted / seconds, protocol: "HTTP", synthetic: true };
  }

  const link = scenarioArtifacts.find(x => x.item.name === "link_loss");
  const queued = await Queue.find({ deviceId: link.deviceId }).sort({ sequenceNumber: 1 }).lean();
  const sequences = queued.map(row => row.sourceSequenceNumber ?? row.sequenceNumber);
  const unique = new Set(sequences);
  const expected = link.item.ticks + 1;
  metrics.offlineRecovery = { scenario: "LINK_LOSS", expectedMessages: expected, forwardedMessages: sequences.length,
    lostMessages: Math.max(0, expected - unique.size), duplicates: sequences.length - unique.size, targetLost: 0, targetDuplicates: 0,
    ordered: sequences.every((value, index) => index === 0 || value >= sequences[index - 1]) };

  const windows = scenarioArtifacts.flatMap(x => x.windows || []).filter(Boolean);
  const gas = windows.map(window => ({ batchId: window.batchId, readings: window.count, gasUsed: Number(window.gasUsed), gasPerReading: Number(window.gasPerReading) }));
  metrics.blockchain = { confirmedAnchors: gas.length, measuredWindows: gas, averageGasPerAnchor: gas.length ? gas.reduce((n, x) => n + x.gasUsed, 0) / gas.length : null,
    averageGasPerReading: gas.length ? gas.reduce((n, x) => n + x.gasUsed, 0) / gas.reduce((n, x) => n + x.readings, 0) : null, chainId: 31337 };

  // Failure isolation is probed through the actual independent consumer
  // handlers using a synthetic event, without stopping shared Compose services.
  const probeId = `SYNTHETIC-PHASE7-ISOLATION-${suffix}`, probeDevice = `SYNTHETIC-ISOLATION-${suffix}`;
  const probeBatch = await Batch.create({ batchId: probeId, vaccineType: "SYNTHETIC FAILURE PROBE — NOT CLINICAL", quantity: 1, manufacturer: "Synthetic Demo Manufacturer", isDemo: true });
  const probePolicy = await Policy.create({ batchId: probeId, vaccineType: probeBatch.vaccineType, minimumTemperature: 2, maximumTemperature: 8,
    minimumHumidity: 0, maximumHumidity: 100, excursionDurationMs: 0, maximumReadingGapMs: 60000, criticalBatteryPercent: 10,
    maximumRateCelsiusPerMinute: 100, sourceReference: "Synthetic isolation probe", approvalReason: "Synthetic probe only", approvedBy: admin._id });
  probeBatch.coldChainPolicyId = probePolicy._id; await probeBatch.save();
  process.env.AI_SERVICE_URL = "http://127.0.0.1:1";
  process.env.AI_BASE_URL = "http://127.0.0.1:1";
  const event = require("../services/eventBackbone").envelope({ deviceId: probeDevice, batchId: probeId, vehicleId: probeDevice,
    temperature: 12, humidity: 50, batteryLevel: 90, recordedAt: new Date(Date.now() - 600000).toISOString(),
    location: { lat: 9.9312, lng: 76.2673 }, sequenceNumber: 0,
    simulation: { source: "phase7-isolation-probe", scenario: "DOOR_OPEN", seed: suffix, tick: 0 } });
  const consumers = require("../services/eventConsumers");
  await consumers.persistence(event); await consumers.policyAlert(event);
  let aiUnavailable = false; try { await consumers.aiAdvisory(event); } catch (_) { aiUnavailable = true; }
  const preservedAlert = await Alert.findOne({ batchId: probeId }).lean();
  process.env.MERKLE_CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000100";
  await consumers.anchoring(event);
  const chainAttempt = await require("../services/merkleAnchoring").processOnce({ now: new Date(), forceRetry: true });
  metrics.failureIsolation = { probeType: "direct independent-consumer handler invocation; shared services were not stopped",
    aiUnavailable, alertPersistedWhileAiUnavailable: Boolean(preservedAlert), ingestionPersistedWhileAiUnavailable: Boolean(await Log.exists({ batchId: probeId })),
    chainUnavailable: chainAttempt.failed > 0, ingestionPersistedWhileChainUnavailable: Boolean(await Log.exists({ batchId: probeId })),
    alertPersistedWhileChainUnavailable: Boolean(await Alert.exists({ batchId: probeId })),
    ingestionAlertSuccessRateAiDown: preservedAlert ? 1 : 0, ingestionAlertSuccessRateChainDown: preservedAlert && await Log.exists({ batchId: probeId }) ? 1 : 0 };

  const forecastCatalog = await call("GET", "/forecast", token).catch(error => ({ error: error.message }));
  const forecastChoice = forecastCatalog.catalog?.find(row => row.ready) || forecastCatalog.catalog?.[0];
  if (forecastChoice?.vaccineType && forecastChoice?.region && forecastChoice.ready) {
    const forecast = await call("GET", `/forecast?vaccineType=${encodeURIComponent(forecastChoice.vaccineType)}&region=${encodeURIComponent(forecastChoice.region)}&horizon=3`, token);
    metrics.forecast = { available: true, synthetic: true, vaccineType: forecastChoice.vaccineType, region: forecastChoice.region,
      runId: forecast.runId, provenance: forecast.forecast.provenance, comparison: forecast.forecast.comparison,
      mape: Object.fromEntries((forecast.forecast.comparison || []).map(row => [row.model, { status: row.status, mape: row.mape,
        mape_excluded_zero_months: row.mape_excluded_zero_months }])) };
  } else metrics.forecast = { available: false, reason: forecastCatalog.error || "Seeded regional series is not ready for a 30-month SARIMA comparison" };
  const outDir = path.join(__dirname, "../results"); await fs.mkdir(outDir, { recursive: true });
  const file = `phase7-evaluation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await fs.writeFile(path.join(outDir, file), `${JSON.stringify(metrics, null, 2)}\n`, { flag: "wx" });
  console.log(`RESULT_FILE=results/${file}`);
  console.log(JSON.stringify(metrics, null, 2));
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => mongoose.disconnect());
