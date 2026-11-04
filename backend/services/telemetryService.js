const { createHash } = require("crypto");
const TemperatureLog = require("../models/TemperatureLog");
const TemperatureAlert = require("../models/TemperatureAlert");
const LocationHistory = require("../models/LocationHistory");
const Batch = require("../models/Batch");
const ColdChainPolicy = require("../models/ColdChainPolicy");
const { processSimulatedTemperatureReading, checkMissingTelemetry } = require("./temperatureAlertService");
const { getTelemetryAnomaly } = require("./aiService");
const fieldOperatorEvents = require("./fieldOperatorEventBus");
const logger = require("./structuredLogger");

function normaliseSequenceNumber(log) {
  const candidate = log.sequenceNumber ?? log.simulation?.tick;
  if (candidate === undefined || candidate === null || candidate === "") return log;
  const sequenceNumber = Number(candidate);
  return Number.isSafeInteger(sequenceNumber) && sequenceNumber >= 0
    ? { ...log, sequenceNumber }
    : log;
}

function buildIdempotencyKey(log) {
  const sourceId = String(log.deviceId || log.sensorId || "").trim();
  if (!sourceId || !Number.isSafeInteger(log.sequenceNumber) || log.sequenceNumber < 0) return null;

  // A retry is the same physical/simulated device sequence even if transport
  // retries change the timestamp envelope or include a different batch context.
  const identity = JSON.stringify([sourceId, log.sequenceNumber]);
  return `v2:${createHash("sha256").update(identity).digest("hex")}`;
}

async function upsertIdempotentTemperatureLog(log, idempotencyKey) {
  try {
    return await TemperatureLog.findOneAndUpdate(
      { idempotencyKey },
      { $setOnInsert: { ...log, idempotencyKey } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // The unique index arbitrates concurrent first writes. If another request won,
    // return its record rather than turning a safe retry into a server error.
    if (error.code !== 11000) throw error;
    const existing = await TemperatureLog.findOne({ idempotencyKey });
    if (!existing) throw error;
    return existing;
  }
}

async function persistTemperatureLogs(logs, { persistenceOnly = false } = {}) {
  if (!persistenceOnly && require("./eventBackbone").enabled()) {
    const checked = require("./telemetryValidation").validateTelemetry(logs);
    if (checked.error) throw Object.assign(new Error(checked.error.details.map(d => d.message).join("; ")), { status: 400 });
    const { normalizeOrCreateCorrelationId } = require("./correlationContext");
    return require("./eventBackbone").publish(checked.value.map(r => ({ ...r,
      correlationId: normalizeOrCreateCorrelationId(r.correlationId) })));
  }
  const docs = [];
  for (const input of logs) {
    const log = normaliseSequenceNumber(input);
    const idempotencyKey = buildIdempotencyKey(log);
    if (idempotencyKey) {
      docs.push(await upsertIdempotentTemperatureLog(log, idempotencyKey));
    } else {
      const [doc] = await TemperatureLog.insertMany([log]);
      docs.push(doc);
    }
  }

  for (const log of docs) {
    logger.info("telemetry.persisted", { correlationId: log.correlationId,
      temperatureLogId: String(log._id), batchId: log.batchId || "" });
    // Keep an append-only queryable GPS trail keyed to the idempotent telemetry
    // record. A retried reading cannot duplicate its location point.
    if (log.batchId && Number.isFinite(log.location?.lat) && Number.isFinite(log.location?.lng)) {
      await LocationHistory.updateOne({ temperatureLogId: log._id }, { $setOnInsert: {
        batchId: log.batchId, shipmentId: log.shipmentId || "", deviceId: log.deviceId || log.sensorId || "",
        vehicleId: log.vehicleId || "", sequenceNumber: log.sequenceNumber,
        correlationId: log.correlationId,
        temperatureLogId: String(log._id), recordedAt: log.recordedAt, location: log.location,
        source: log.source || log.simulation?.telemetrySource || log.simulation?.source,
        enteredBy: log.enteredBy || "",
        note: log.note || "",
        isDemo: Boolean(log.isDemo), demoProvenance: log.demoProvenance,
      } }, { upsert: true, setDefaultsOnInsert: true });
    }
    // A completed retry returns the stored record without repeating evaluation.
    // A prior write interrupted before evaluation has no evaluation field and can
    // safely resume the remaining work against that same record.
    if (persistenceOnly || log.evaluation) continue;
    let anomalyInference = {
      status: "NOT_RUN", is_anomaly: false, advisory_only: true, history_count: 0, metrics: {},
      reason: "Anomaly inference requires a batch-linked reading with a device identifier and finite temperature.",
    };
    if (log.batchId && (log.deviceId || log.sensorId) && Number.isFinite(log.temperature)) {
      let history = [];
      let policyLimits = null;
      try {
        const batch = await Batch.findOne({ batchId: log.batchId }).select("coldChainPolicyId vaccineType").lean();
        const policy = batch?.coldChainPolicyId ? await ColdChainPolicy.findById(batch.coldChainPolicyId)
          .select("batchId vaccineType minimumTemperature maximumTemperature").lean() : null;
        if (policy && policy.batchId === batch.batchId && policy.vaccineType === batch.vaccineType) {
          policyLimits = { minimumTemperature: policy.minimumTemperature, maximumTemperature: policy.maximumTemperature };
        }
        history = await TemperatureLog.find({
          batchId: log.batchId,
          deviceId: log.deviceId || log.sensorId,
          _id: { $ne: log._id },
          recordedAt: { $lt: log.recordedAt, $gte: new Date(+log.recordedAt - 1800000) },
        }).sort({ recordedAt: -1, _id: -1 }).limit(1000).select("temperature humidity recordedAt location evaluation").lean();
        // Preserve consecutive prior samples: the AI service recomputes their
        // raw scores to apply its 2-of-3 persistence rule consistently.
        history = history.reverse()
          .map(({ temperature, humidity, recordedAt, location }) => ({ temperature, humidity,
            recorded_at: recordedAt?.toISOString?.() || null, latitude: location?.lat, longitude: location?.lng }));
      } catch (_) {
        // Missing or temporarily inaccessible context is reported to the model as
        // an empty baseline; it never replaces the policy-rule evaluation below.
        history = [];
      }
      anomalyInference = await getTelemetryAnomaly({ temperature: log.temperature,
        humidity: Number.isFinite(log.humidity) ? log.humidity : null, history,
        batchId: log.batchId, deviceId: log.deviceId || log.sensorId, timestamp: log.recordedAt?.toISOString?.(),
        latitude: log.location?.lat, longitude: log.location?.lng,
        minimumTemperature: policyLimits?.minimumTemperature, maximumTemperature: policyLimits?.maximumTemperature,
        correlationId: log.correlationId });
    }
    const detection = await processSimulatedTemperatureReading({
      batchId: log.batchId, shipmentId: log.shipmentId, deviceId: log.deviceId || log.sensorId,
      vehicleId: log.vehicleId, temperature: log.temperature, humidity: log.humidity,
      batteryLevel: log.batteryLevel, latitude: log.location?.lat, longitude: log.location?.lng,
      timestamp: log.recordedAt, simulation: log.simulation, source: log.source, enteredBy: log.enteredBy,
      note: log.note, needsReview: log.needsReview, supersedes: log.supersedes, anomalyInference, correlationId: log.correlationId,
    }, log._id);
    detection.anomalyInference = anomalyInference;
    const status = detection.evaluated ? (detection.severity !== "NORMAL" ? "Alert" : "Normal") : (log.status || "Normal");
    await TemperatureLog.updateOne({ _id: log._id }, { $set: { status, evaluation: detection } });
    log.status = status;
    log.evaluation = detection;
    if (detection.evaluated) await checkMissingTelemetry(log.batchId, log.recordedAt);
    logger.info("telemetry.evaluated", { correlationId: log.correlationId, temperatureLogId: String(log._id),
      policyStatus: detection.policyStatus, alertCount: detection.alertIds?.length || 0 });

    // Publish only after the reading, policy evaluation, alert records, and any
    // resulting quarantine updates have been persisted. These events are a live
    // view; MongoDB remains the source of truth.
    if (log.shipmentId) {
      await fieldOperatorEvents.publishReading(log.shipmentId, log, {
        persistedLog: log,
        alertsTriggered: detection.alertIds || [],
      });
      if (detection.alertIds?.length) try {
        const alerts = await TemperatureAlert.find({
          alertId: { $in: detection.alertIds },
          shipmentId: log.shipmentId,
        }).sort({ timestamp: 1, alertId: 1 }).lean();
        for (const alert of alerts) fieldOperatorEvents.publishAlert(alert);
      } catch (_) { /* Live delivery is best-effort after authoritative persistence. */ }
    }
    await require("./dashboardEventBus").publishReading(log);
    if (log.shipmentId && Number.isFinite(log.location?.lat) && Number.isFinite(log.location?.lng)) {
      await require("./dashboardEventBus").publishPosition(log);
    }
  }
  return docs;
}

function simulationReadingToTemperatureLog(reading) {
  const sequenceNumber = reading.sequenceNumber ?? reading.simulation?.tick;
  const legacySource = reading.source || reading.simulation?.telemetrySource || "simulator";
  const source = legacySource === "auto-simulated" || legacySource === "software-iot-simulator" ? "simulator"
    : legacySource === "manual-override" ? "manual" : legacySource;
  return {
    ...(reading.correlationId ? { correlationId: reading.correlationId } : {}),
    shipmentId: reading.shipmentId || "",
    batchId: reading.batchId || "",
    sensorId: reading.deviceId,
    deviceId: reading.deviceId,
    vehicleId: reading.vehicleId || "",
    source,
    ...(reading.enteredBy ? { enteredBy: reading.enteredBy } : {}),
    ...(reading.note ? { note: reading.note } : {}),
    ...(reading.needsReview ? { needsReview: true } : {}),
    ...(reading.supersedes ? { supersedes: reading.supersedes } : {}),
    overrideId: reading.overrideId || null,
    operatorUserId: reading.operatorUserId || "",
    ...(sequenceNumber === undefined ? {} : { sequenceNumber }),
    ...(reading.edge ? { edge: reading.edge } : {}),
    temperature: reading.temperature,
    humidity: reading.humidity,
    batteryLevel: reading.batteryLevel,
    recordedAt: new Date(reading.timestamp),
    location: {
      lat: reading.latitude,
      lng: reading.longitude,
    },
    simulation: reading.simulation,
  };
}

async function persistSimulationReading(reading) {
  const [log] = await persistTemperatureLogs([simulationReadingToTemperatureLog(reading)]);
  return log;
}

module.exports = {
  persistTemperatureLogs,
  normaliseSequenceNumber,
  buildIdempotencyKey,
  simulationReadingToTemperatureLog,
  persistSimulationReading,
};
