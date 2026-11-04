const mongoose = require("mongoose");
const Log = require("../models/TemperatureLog");
const Receipt = require("../models/EventReceipt");
const Batch = require("../models/Batch");
const Policy = require("../models/ColdChainPolicy");
const Alert = require("../models/TemperatureAlert");
const backbone = require("./eventBackbone");
const fieldEvents = require("./fieldOperatorEventBus");
const { withBatchLock } = require("./coldChainLock");
const pending = () => Object.assign(new Error("Upstream consumer has not committed this event"), { dependencyPending: true });
const retentionSeconds = () => Math.max(86400, Number(process.env.TELEMETRY_RETENTION_SECONDS || 7776000));
async function initialize() {
  // Mongoose 8 propagates the transaction session through async-local context.
  mongoose.set("transactionAsyncLocalStorage", true);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) throw new Error("Event backbone requires a MongoDB replica set for atomic policy transactions");
  await Promise.all([Receipt.init(), require("../models/NotificationOutbox").init(), Log.init()]);
  const db = mongoose.connection.db;
  const name = "telemetry_measurements";
  if (!(await db.listCollections({ name }).toArray()).length) await db.createCollection(name, {
    timeseries: { timeField: "recordedAt", metaField: "device", granularity: "seconds" },
    expireAfterSeconds: retentionSeconds(),
  });
  const collection = db.collection(name);
  await collection.createIndex({ "device.batchId": 1, recordedAt: -1 });
  await collection.createIndex({ eventId: 1 });
  await require("../models/LocationHistory").init();
  // Convert the existing recordedAt index to TTL without dropping location data.
  const locations = require("../models/LocationHistory").collection;
  const indexes = await locations.indexes();
  if (indexes.some(index => Object.keys(index.key).length === 1 && index.key.recordedAt === 1)) {
    await db.command({ collMod: locations.name,
      index: { keyPattern: { recordedAt: 1 }, expireAfterSeconds: retentionSeconds() } });
  } else await locations.createIndex({ recordedAt: 1 }, { expireAfterSeconds: retentionSeconds(), name: "recordedAt_1" });
}
async function completed(event, group) { return Receipt.exists({ eventId: event.eventId, group }); }
async function finish(event, group, readingId) {
  await Receipt.updateOne({ eventId: event.eventId, group }, { $setOnInsert: { correlationId: event.correlationId, readingId } }, { upsert: true });
}
async function logFor(event) {
  const receipt = await Receipt.findOne({ eventId: event.eventId, group: "persistence" });
  if (!receipt) throw pending();
  const log = await Log.findById(receipt.readingId || event.reading._id);
  if (!log) throw new Error("Persisted telemetry projection is missing");
  return log;
}
async function persistence(event) {
  if (await completed(event, "persistence")) return;
  const [log] = await require("./telemetryService").persistTemperatureLogs([event.reading], { persistenceOnly: true });
  const collection = mongoose.connection.db.collection("telemetry_measurements");
  // Time-series collections cannot have unique event indexes or participate in
  // transactions on MongoDB 7. One sequential group owner checks eventId on replay.
  if (!await collection.findOne({ eventId: event.eventId })) await collection.insertOne({
    eventId: event.eventId, correlationId: event.correlationId, recordedAt: log.recordedAt,
    device: { deviceId: log.deviceId || log.sensorId || "", batchId: log.batchId || "", shipmentId: log.shipmentId || "" },
    temperature: log.temperature, humidity: log.humidity, batteryLevel: log.batteryLevel,
    vehicleId: log.vehicleId, sequenceNumber: log.sequenceNumber, location: log.location,
    source: log.source || "simulator", enteredBy: log.enteredBy || "", note: log.note || "",
    needsReview: Boolean(log.needsReview), supersedes: log.supersedes || null,
    edge: log.edge, synthetic: true,
  });
  await finish(event, "persistence", log._id);
}
async function policyAlert(event) {
  if (await completed(event, "policy-alert")) return;
  const log = await logFor(event);
  await withBatchLock(log.batchId, () => mongoose.connection.transaction(async () => {
    if (await completed(event, "policy-alert")) return;
    const detection = await require("./temperatureAlertService").evaluateReading({
      batchId: log.batchId, shipmentId: log.shipmentId, deviceId: log.deviceId || log.sensorId,
      vehicleId: log.vehicleId, temperature: log.temperature, humidity: log.humidity,
      batteryLevel: log.batteryLevel, latitude: log.location?.lat, longitude: log.location?.lng,
      timestamp: log.recordedAt, simulation: log.simulation, source: log.source,
      enteredBy: log.enteredBy, note: log.note, needsReview: log.needsReview,
      supersedes: log.supersedes, correlationId: event.correlationId,
    }, log._id);
    const status = detection.evaluated && detection.severity !== "NORMAL" ? "Alert" : "Normal";
    // Individual field writes avoid racing the independent advisory consumer.
    await Log.updateOne({ _id: log._id }, { $set: { status, "evaluation.policy": detection,
      ...Object.fromEntries(Object.entries(detection).map(([key, value]) => [`evaluation.${key}`, value])) } });
    await finish(event, "policy-alert");
  }));
  await publishLive(await Log.findById(log._id));
}
async function publishLive(log, eventType = "READING") {
  await require("./dashboardEventBus").publishReading(log, eventType);
  if (log.shipmentId && Number.isFinite(log.location?.lat) && Number.isFinite(log.location?.lng)) {
    await require("./dashboardEventBus").publishPosition(log);
  }
  if (!log.shipmentId) return;
  await fieldEvents.publishReading(log.shipmentId, log, { persistedLog: log, alertsTriggered: log.evaluation?.alertIds || [] });
  for (const alert of await Alert.find({ alertId: { $in: log.evaluation?.alertIds || [] } }).lean()) fieldEvents.publishAlert(alert);
}
async function aiAdvisory(event) {
  if (await completed(event, "ai-advisory")) return;
  const log = await logFor(event);
  const batch = await Batch.findOne({ batchId: log.batchId }).lean();
  const policy = batch?.coldChainPolicyId ? await Policy.findById(batch.coldChainPolicyId).lean() : null;
  const history = (await Log.find({ batchId: log.batchId, deviceId: log.deviceId,
    recordedAt: { $lt: log.recordedAt, $gte: new Date(+log.recordedAt - 1800000) } }).sort({ recordedAt: -1 }).limit(1000).lean()).reverse()
    .map(row => ({ temperature: row.temperature, humidity: row.humidity, recorded_at: row.recordedAt.toISOString(),
      latitude: row.location?.lat, longitude: row.location?.lng }));
  const result = await require("./aiService").getTelemetryAnomaly({ temperature: log.temperature,
    humidity: log.humidity ?? null, history, batchId: log.batchId, deviceId: log.deviceId,
    timestamp: log.recordedAt.toISOString(), latitude: log.location?.lat, longitude: log.location?.lng,
    minimumTemperature: policy?.minimumTemperature,
    maximumTemperature: policy?.maximumTemperature, correlationId: event.correlationId });
  await Log.updateOne({ _id: log._id }, { $set: { "evaluation.anomalyInference": result } });
  for (const alert of await Alert.find({ alertId: { $in: log.evaluation?.alertIds || [] } })) {
    alert.context = { ...(alert.context || {}), anomalyInference: { status: result.status, model: result.model,
      advisoryOnly: true, reason: result.reason, label: result.label, score: result.score, contributions: result.contributions || [] } };
    await alert.save();
    await require("./dashboardEventBus").publishAlert(alert, "UPDATED");
  }
  if (result.status === "UNAVAILABLE") throw new Error("Advisory AI service unavailable; policy consumer continues independently");
  await finish(event, "ai-advisory");
  // Advisory result enriches the reading only; never re-runs policy or sets holds.
  await publishLive(await Log.findById(log._id), "AI_ADVISORY_UPDATED");
}
async function anchoring(event) {
  if (await completed(event, "anchoring")) return;
  const log = await logFor(event);
  if (!await completed(event, "policy-alert")) throw pending();
  if (process.env.AUDIT_ANCHOR_ENABLED !== "true") throw new Error("Local chain anchoring is disabled");
  if (process.env.TELEMETRY_ANCHOR_MODE !== "legacy") {
    await require("./merkleAnchoring").stage(log);
    await finish(event, "anchoring");
    return;
  }
  const result = await require("./auditAnchoring").processOnce(200, {
    readingId: log._id, alertIds: log.evaluation?.alertIds || [],
  });
  if (result.busy) throw pending();
  if (result.failed) throw new Error("Local chain evidence is not confirmed");
  await finish(event, "anchoring");
}
async function start() {
  if (!backbone.enabled()) return;
  await initialize();
  await backbone.start({ persistence, "policy-alert": policyAlert, "ai-advisory": aiAdvisory, anchoring });
  require("./notificationDispatcher").start();
}
module.exports = { initialize, start, persistence, policyAlert, aiAdvisory, anchoring, retentionSeconds };
