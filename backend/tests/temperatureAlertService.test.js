const mongoose = require("mongoose");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Alert = require("../models/TemperatureAlert");
const Log = require("../models/TemperatureLog");
const Notification = require("../models/Notification");
const State = require("../models/TelemetryState");
const Audit = require("../models/ColdChainAudit");
const Policy = require("../models/ColdChainPolicy");
const { persistSimulationReading, persistTemperatureLogs } = require("../services/telemetryService");
const { evaluateTemperature, evaluateReading, checkMissingTelemetry } = require("../services/temperatureAlertService");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
beforeAll(connect, 15000);
afterAll(close);

test("temperature thresholds are policy-specific; magnitude alone never establishes sustained exposure", () => {
  const policy = { minimumTemperature: -20, maximumTemperature: -10 };
  expect(evaluateTemperature({ temperature: -15, policy }).violationType).toBe("NORMAL");
  expect(evaluateTemperature({ temperature: 5, policy })).toMatchObject({ violationType: "HIGH_TEMPERATURE", deviation: 15, severity: "WARNING" });
});
test("legacy limits do not masquerade as an approved policy", async () => {
  const f = await fixture({ approved: false });
  expect(await evaluateReading(f.reading(20))).toMatchObject({ evaluated: false, policyStatus: "POLICY_NOT_APPROVED" });
  expect(await Alert.countDocuments({ batchId: f.batchId })).toBe(0);
});
test("a normal reading is recorded without an alert or notification", async () => {
  const f = await fixture();
  const log = await persistSimulationReading(f.reading(5));
  expect(log.status).toBe("Normal");
  expect(log.evaluation).toMatchObject({ evaluated: true, severity: "NORMAL", recommendedAction: "RECORD_NORMAL" });
  expect(await Notification.countDocuments({ auditBatchId: f.batchId })).toBe(0);
});
test("brief excursions request a reading, deduplicate notifications, and recover without quarantine", async () => {
  const f = await fixture();
  await evaluateReading(f.reading(10, 0));
  await evaluateReading(f.reading(10, 1));
  expect(await Alert.countDocuments({ batchId: f.batchId })).toBe(1);
  expect(await Notification.countDocuments({ auditBatchId: f.batchId })).toBe(2);
  const normal = await evaluateReading(f.reading(5, 2));
  expect(normal.batchQuarantined).toBe(false);
  expect(await Alert.findOne({ batchId: f.batchId }).lean()).toMatchObject({ phase: "RECOVERED", status: "RESOLVED" });
});
test.each([10.8, 0])("sustained %s°C excursions hold the batch and all its shipments; recovery does not release", async temperature => {
  const f = await fixture();
  await Shipment.create({ shipmentId: `${f.shipmentId}-2`, batchId: f.batchId, distributor: "dist-b", destination: "hospital-b" });
  for (let minute = 0; minute <= 2; minute++) await evaluateReading(f.reading(temperature, minute));
  const alert = await Alert.findOne({ batchId: f.batchId }).lean();
  expect(alert).toMatchObject({ severity: "CRITICAL", phase: "QUARANTINED", requiresQualityReview: true, excursionDurationMs: 120000 });
  expect(alert.reason).toContain("2 consecutive measured minutes");
  expect((await Batch.findOne({ batchId: f.batchId })).coldChainHoldAlertIds).toContain(alert.alertId);
  expect(await Shipment.countDocuments({ batchId: f.batchId, coldChainHoldAlertIds: alert.alertId })).toBe(2);
  expect(await Notification.distinct("recipientRole", { auditBatchId: f.batchId })).toEqual(expect.arrayContaining(["admin", "manufacturer", "distributor", "healthcare"]));
  const normal = await evaluateReading(f.reading(5, 3));
  expect(normal).toMatchObject({ severity: "NORMAL", batchQuarantined: true, recommendedAction: "QUARANTINE_PENDING_REVIEW" });
  expect(await Alert.findOne({ alertId: alert.alertId }).lean()).toMatchObject({ requiresQualityReview: true, phase: "QUARANTINED" });
});
test("the supplied explanation example is reproducible at exactly 18 minutes", async () => {
  const f = await fixture({ policy: { excursionDurationMs: 18 * 60000 } });
  for (let minute = 0; minute <= 18; minute++) await evaluateReading(f.reading(10.8, minute));
  const alert = await Alert.findOne({ batchId: f.batchId }).lean();
  expect(alert.reason).toBe("Critical: 10.8°C is 2.8°C above the approved maximum of 8°C for 18 consecutive measured minutes.");
});
test("gaps and direction changes restart continuous exposure instead of inventing a sustained event", async () => {
  const f = await fixture();
  await evaluateReading(f.reading(10, 0));
  const gap = await evaluateReading(f.reading(10, 3));
  expect(gap.batchQuarantined).toBe(false);
  expect(gap.confidence).toBe("LIMITED");
  expect(gap.reasons.join(" ")).toContain("continuous exposure is unknown");
  await evaluateReading(f.reading(0, 4));
  const active = await Alert.findOne({ batchId: f.batchId, violationType: "LOW_TEMPERATURE", activeExcursionKey: { $exists: true } });
  expect(active.excursionDurationMs).toBe(0);
  expect(active.excursionStartedAt.toISOString()).toBe(f.at(4));
});
test("duplicate/out-of-order readings cannot roll back or release a hold", async () => {
  const f = await fixture();
  await Promise.all([evaluateReading(f.reading(10)), evaluateReading(f.reading(10))]);
  for (let minute = 1; minute <= 2; minute++) await evaluateReading(f.reading(10, minute));
  expect(await evaluateReading(f.reading(5, 0))).toMatchObject({ evaluated: false, policyStatus: "STALE_OR_DUPLICATE_READING" });
  expect(await Alert.countDocuments({ batchId: f.batchId })).toBe(1);
  expect((await Batch.findOne({ batchId: f.batchId })).coldChainHoldAlertIds).toHaveLength(1);
});
test("humidity, critically low battery, and rate-of-change produce exact reliability reasons", async () => {
  const f = await fixture({ policy: { maximumRateCelsiusPerMinute: 1 } });
  await evaluateReading(f.reading(5));
  const result = await evaluateReading(f.reading(7, 1, { humidity: 90, batteryLevel: 2 }));
  expect(result).toMatchObject({ severity: "WARNING", confidence: "LIMITED", batchQuarantined: false });
  expect(result.reasons.join(" ")).toMatch(/Humidity 90%/);
  expect(result.reasons.join(" ")).toMatch(/Battery 2%/);
  expect(result.reasons.join(" ")).toMatch(/2°C\/min/);
  expect(await Alert.countDocuments({ batchId: f.batchId })).toBe(2);
});
test("explicit simulation-clock checks detect silence and are idempotent; late data cannot erase silence", async () => {
  const f = await fixture();
  await evaluateReading(f.reading(5));
  expect(await checkMissingTelemetry(f.batchId, f.at(3))).toHaveLength(1);
  expect(await checkMissingTelemetry(f.batchId, f.at(3))).toHaveLength(0);
  expect(await evaluateReading(f.reading(5, 1))).toMatchObject({ evaluated: false });
  expect(await Alert.countDocuments({ batchId: f.batchId, violationType: "TELEMETRY_RELIABILITY" })).toBe(1);
  expect((await State.findOne({ batchId: f.batchId })).checkedAt.toISOString()).toBe(f.at(3));
});
test("ingestion of one stream checks for missing peer streams using the same event clock", async () => {
  const f = await fixture();
  await persistSimulationReading(f.reading(5, 0, { deviceId: "silent" }));
  await persistSimulationReading(f.reading(5, 0, { deviceId: "active" }));
  await persistSimulationReading(f.reading(5, 1, { deviceId: "active" }));
  await persistSimulationReading(f.reading(5, 2, { deviceId: "active" }));
  expect(await Alert.findOne({ batchId: f.batchId, deviceId: "silent" }).lean()).toMatchObject({ phase: "RELIABILITY_ISSUE" });
});
test("legacy ingestion fields remain optional and unapproved raw status is preserved", async () => {
  const [log] = await persistTemperatureLogs([{ temperature: 5, sensorId: "legacy", status: "Alert" }]);
  expect(log.status).toBe("Alert");
  expect(log.evaluation.evaluated).toBe(false);
  expect(await Log.findById(log._id)).not.toBeNull();
});
test("policy and audit revisions reject model-level updates, deletes and bulk updates", async () => {
  const f = await fixture();
  const record = await Audit.create({ batchId: f.batchId, action: "TEST", actorId: String(f.reviewer._id), reason: "Fixture", eventTime: new Date() });
  await expect(Audit.updateOne({ _id: record._id }, { reason: "rewrite" })).rejects.toThrow("Append-only");
  await expect(record.deleteOne()).rejects.toThrow("Append-only");
  await expect(Audit.bulkWrite([{ updateOne: { filter: { _id: record._id }, update: { reason: "rewrite" } } }])).rejects.toThrow("Append-only");
  f.policy.minimumTemperature = -99;
  await expect(f.policy.save()).rejects.toThrow("Append-only");
  await expect(Policy.deleteMany({ _id: f.policy._id })).rejects.toThrow("Append-only");
  expect(await Audit.findById(record._id)).not.toBeNull();
});
