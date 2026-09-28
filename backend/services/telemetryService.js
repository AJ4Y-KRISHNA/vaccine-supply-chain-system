const { createHash } = require("crypto");
const TemperatureLog = require("../models/TemperatureLog");
const { processSimulatedTemperatureReading, checkMissingTelemetry } = require("./temperatureAlertService");

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
  const batchId = String(log.batchId || "").trim();
  const timestamp = new Date(log.recordedAt);
  if (!sourceId || !batchId || !Number.isFinite(timestamp.getTime()) ||
    !Number.isSafeInteger(log.sequenceNumber) || log.sequenceNumber < 0) return null;

  const identity = JSON.stringify([sourceId, batchId, timestamp.toISOString(), log.sequenceNumber]);
  return `v1:${createHash("sha256").update(identity).digest("hex")}`;
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

async function persistTemperatureLogs(logs) {
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
    // A completed retry returns the stored record without repeating evaluation.
    // A prior write interrupted before evaluation has no evaluation field and can
    // safely resume the remaining work against that same record.
    if (log.evaluation) continue;
    const detection = await processSimulatedTemperatureReading({
      batchId: log.batchId, shipmentId: log.shipmentId, deviceId: log.deviceId || log.sensorId,
      vehicleId: log.vehicleId, temperature: log.temperature, humidity: log.humidity,
      batteryLevel: log.batteryLevel, latitude: log.location?.lat, longitude: log.location?.lng,
      timestamp: log.recordedAt, simulation: log.simulation,
    }, log._id);
    const status = detection.evaluated ? (detection.severity !== "NORMAL" ? "Alert" : "Normal") : (log.status || "Normal");
    await TemperatureLog.updateOne({ _id: log._id }, { $set: { status, evaluation: detection } });
    log.status = status;
    log.evaluation = detection;
    if (detection.evaluated) await checkMissingTelemetry(log.batchId, log.recordedAt);
  }
  return docs;
}

function simulationReadingToTemperatureLog(reading) {
  const sequenceNumber = reading.sequenceNumber ?? reading.simulation?.tick;
  return {
    shipmentId: reading.shipmentId || "",
    batchId: reading.batchId || "",
    sensorId: reading.deviceId,
    deviceId: reading.deviceId,
    vehicleId: reading.vehicleId || "",
    ...(reading.source ? { source: reading.source } : {}),
    overrideId: reading.overrideId || null,
    operatorUserId: reading.operatorUserId || "",
    ...(sequenceNumber === undefined ? {} : { sequenceNumber }),
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
  buildIdempotencyKey,
  simulationReadingToTemperatureLog,
  persistSimulationReading,
};
