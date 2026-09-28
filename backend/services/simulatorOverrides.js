const { createHash, randomUUID } = require("node:crypto");
const SimulatorOverride = require("../models/SimulatorOverride");
const SimulatorOverrideAudit = require("../models/SimulatorOverrideAudit");
const Shipment = require("../models/Shipment");
const { withBatchLock } = require("./coldChainLock");

const HARD_MAX_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MIN_TTL_MS = 10;
const presets = [
  { id: "refrigeration-failure", name: "Refrigeration failure", description: "Synthetic sustained warming; evaluate against the batch's approved policy.", values: { targetTemperature: 12, targetHumidity: null, behavior: "ramp", rampDuration: 2, holdDuration: 10 } },
  { id: "door-left-open", name: "Door left open", description: "Synthetic warming and moisture increase.", values: { targetTemperature: 10, targetHumidity: 85, behavior: "ramp", rampDuration: 1, holdDuration: 10 } },
  { id: "freezing-risk", name: "Freezing risk", description: "Synthetic low-temperature excursion.", values: { targetTemperature: -2, targetHumidity: null, behavior: "ramp", rampDuration: 2, holdDuration: 10 } },
  { id: "low-humidity", name: "Low humidity", description: "Synthetic low-humidity excursion.", values: { targetTemperature: null, targetHumidity: 20, behavior: "hold", rampDuration: 0, holdDuration: 10 } },
  { id: "sensor-fault", name: "Sensor fault", description: "Suppresses samples; the existing missing-telemetry policy checks for an expected sensor gap.", values: { targetTemperature: null, targetHumidity: null, effect: "SENSOR_FAULT", behavior: "hold", rampDuration: 0, holdDuration: 10 } },
].map(preset => Object.freeze({ ...preset, values: Object.freeze({ ...preset.values }) }));

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const numberOr = (value, fallback) => Number.isInteger(Number(value)) ? Number(value) : fallback;
function ttlLimits() {
  const max = Math.max(MIN_TTL_MS, Math.min(HARD_MAX_TTL_MS, numberOr(process.env.SIMULATOR_OVERRIDE_MAX_TTL_MS, HARD_MAX_TTL_MS)));
  const configuredDefault = numberOr(process.env.SIMULATOR_OVERRIDE_DEFAULT_TTL_MS, DEFAULT_TTL_MS);
  return { max, default: Math.max(MIN_TTL_MS, Math.min(max, configuredDefault)) };
}
function presetById(id) { return presets.find(preset => preset.id === id); }
function listPresets() {
  return presets.map(({ id, name, description, values }) => ({ id, name, description, ...values }));
}
function resolveValues(input, prior = null) {
  const preset = input.presetId ? presetById(input.presetId) : null;
  if (input.presetId && !preset) throw fail(400, "Unknown simulator override preset");
  const base = prior ? {
    targetTemperature: prior.targetTemperature,
    targetHumidity: prior.targetHumidity,
    behavior: prior.behavior,
    rampDuration: prior.rampDuration,
    holdDuration: prior.holdDuration,
    effect: prior.effect,
    presetId: prior.presetId,
  } : { behavior: "hold", rampDuration: 0, holdDuration: 10, effect: "READING" };
  const merged = { ...base, ...(preset?.values || {}), ...input };
  // Null means a preset deliberately does not target that measurement.
  const targetTemperature = merged.targetTemperature == null ? undefined : Number(merged.targetTemperature);
  const targetHumidity = merged.targetHumidity == null ? undefined : Number(merged.targetHumidity);
  const effect = preset?.values.effect || (input.presetId ? "READING" : merged.effect || "READING");
  if (effect === "SENSOR_FAULT" && (targetTemperature !== undefined || targetHumidity !== undefined)) {
    throw fail(400, "The Sensor fault preset suppresses readings and cannot include target measurements");
  }
  if (effect !== "SENSOR_FAULT" && targetTemperature === undefined && targetHumidity === undefined) {
    throw fail(400, "Set a target temperature or humidity, or choose the Sensor fault preset");
  }
  if (targetTemperature !== undefined && (!Number.isFinite(targetTemperature) || targetTemperature < -40 || targetTemperature > 60)) throw fail(400, "targetTemperature must be between -40 and 60°C");
  if (targetHumidity !== undefined && (!Number.isFinite(targetHumidity) || targetHumidity < 0 || targetHumidity > 100)) throw fail(400, "targetHumidity must be between 0 and 100%");
  const behavior = merged.behavior || "hold";
  const rampDuration = Number(merged.rampDuration ?? 0);
  const holdDuration = Number(merged.holdDuration ?? 10);
  if (!["hold", "ramp"].includes(behavior) || !Number.isFinite(rampDuration) || rampDuration < 0 || rampDuration > 1440 ||
    !Number.isFinite(holdDuration) || holdDuration <= 0 || holdDuration > 1440 || behavior === "ramp" && rampDuration <= 0) {
    throw fail(400, "Use hold or ramp with valid durations of at most 1440 simulated minutes");
  }
  const { max, default: defaultTtl } = ttlLimits();
  const expiresInMs = input.expiresInMs === undefined ? defaultTtl : Number(input.expiresInMs);
  if (!Number.isSafeInteger(expiresInMs) || expiresInMs < MIN_TTL_MS || expiresInMs > max) {
    throw fail(400, `expiresInMs must be between ${MIN_TTL_MS} and ${max}; the configured hard cap cannot be exceeded`);
  }
  if ((rampDuration + holdDuration) * 60000 > expiresInMs) throw fail(400, "Override expiry must cover its ramp and hold durations");
  const reason = String(input.reason ?? (preset ? `Applied preset: ${preset.name}` : prior?.reason || "")).trim();
  if (!reason || reason.length > 500) throw fail(400, "A reason of 1 to 500 characters is required");
  return { presetId: preset?.id || (input.presetId === undefined ? prior?.presetId : input.presetId), effect,
    targetTemperature, targetHumidity, behavior, rampDuration, holdDuration, expiresInMs, reason };
}

function overrideValues(override) {
  return {
    mode: override.mode, status: override.status, presetId: override.presetId, effect: override.effect,
    targetTemperature: override.targetTemperature, targetHumidity: override.targetHumidity,
    behavior: override.behavior, rampDuration: override.rampDuration, holdDuration: override.holdDuration,
    effectiveAt: override.effectiveAt, expiresAt: override.expiresAt, releasedAt: override.releasedAt,
  };
}
async function appendAudit(override, action, actorId, eventTime, reason) {
  const values = overrideValues(override);
  const eventKey = createHash("sha256").update(JSON.stringify([
    override.overrideId, action, String(actorId), new Date(eventTime).toISOString(), reason, values,
  ])).digest("hex");
  try {
    return await SimulatorOverrideAudit.create({ eventKey, overrideId: override.overrideId,
      shipmentId: override.shipmentId, batchId: override.batchId, action, actorId: String(actorId),
      eventTime: new Date(eventTime), reason, values });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return SimulatorOverrideAudit.findOne({ eventKey });
  }
}
function behaviorEnd(override) {
  return +new Date(override.effectiveAt || override.createdAt) + (Number(override.rampDuration || 0) + Number(override.holdDuration || 0)) * 60000;
}
async function closeOverride(override, action, eventTime, actorId, reason) {
  override.status = action === "EXPIRED" ? "EXPIRED" : "RELEASED";
  override.mode = "auto";
  override.releasedAt = new Date(eventTime);
  override.updatedBy = String(actorId);
  override.reason = reason;
  await override.save();
  await appendAudit(override, action, actorId, eventTime, reason);
  return override;
}
function deviceStarts(timeline) {
  return new Map(timeline.devices.map(device => [device.deviceId, {
    temperature: Number.isFinite(device.temperature) ? device.temperature : null,
    humidity: Number.isFinite(device.humidity) ? device.humidity : null,
  }]));
}
function toPlain(override) { return override.toObject({ flattenMaps: true }); }

async function createOverride({ input, actorId, manager }) {
  const shipment = await Shipment.findOne({ shipmentId: input.shipmentId }).lean();
  if (!shipment) throw fail(404, "Shipment not found");
  return withBatchLock(shipment.batchId, async () => {
    const currentShipment = await Shipment.findOne({ shipmentId: input.shipmentId }).lean();
    if (!currentShipment || currentShipment.batchId !== shipment.batchId) throw fail(409, "Shipment assignment changed; retry the override request");
    const timeline = manager.getShipmentTimeline(shipment.shipmentId);
    if (timeline.batchId !== shipment.batchId) throw fail(409, "Simulator device is no longer linked to this shipment");
    const active = await SimulatorOverride.findOne({ shipmentId: shipment.shipmentId, status: "ACTIVE" });
    if (active) {
      if (+timeline.eventTime < Math.min(+new Date(active.expiresAt), behaviorEnd(active))) throw fail(409, "Shipment already has an active manual override; modify or release it first");
      await closeOverride(active, "EXPIRED", timeline.eventTime, "SYSTEM", "Override duration elapsed on the simulation clock.");
    }
    const values = resolveValues(input);
    const override = await SimulatorOverride.create({
      overrideId: `OVR-${randomUUID()}`, shipmentId: shipment.shipmentId, batchId: shipment.batchId,
      mode: "manual", status: "ACTIVE", presetId: values.presetId, effect: values.effect,
      ...(values.targetTemperature === undefined ? {} : { targetTemperature: values.targetTemperature }),
      ...(values.targetHumidity === undefined ? {} : { targetHumidity: values.targetHumidity }),
      behavior: values.behavior, rampDuration: values.rampDuration, holdDuration: values.holdDuration,
      expiresAt: new Date(+timeline.eventTime + values.expiresInMs), createdBy: actorId,
      updatedBy: String(actorId), createdAt: timeline.eventTime, effectiveAt: timeline.eventTime,
      reason: values.reason, deviceStarts: deviceStarts(timeline),
    });
    await appendAudit(override, "STARTED", actorId, timeline.eventTime, values.reason);
    return toPlain(override);
  });
}

async function modifyOverride({ overrideId, input, actorId, manager }) {
  const found = await SimulatorOverride.findOne({ overrideId });
  if (!found) throw fail(404, "Simulator override not found");
  return withBatchLock(found.batchId, async () => {
    const override = await SimulatorOverride.findOne({ overrideId });
    if (!override) throw fail(404, "Simulator override not found");
    if (override.status !== "ACTIVE" || override.mode !== "manual") throw fail(409, "Only an active manual override can be modified");
    const timeline = manager.getShipmentTimeline(override.shipmentId);
    const eventTime = timeline.eventTime;
    if (+eventTime >= Math.min(+new Date(override.expiresAt), behaviorEnd(override))) {
      await closeOverride(override, "EXPIRED", eventTime, "SYSTEM", "Override duration elapsed on the simulation clock.");
      throw fail(409, "Simulator override has expired");
    }
    const values = resolveValues(input, override);
    Object.assign(override, {
      mode: "manual", status: "ACTIVE", presetId: values.presetId, effect: values.effect,
      targetTemperature: values.targetTemperature, targetHumidity: values.targetHumidity,
      behavior: values.behavior, rampDuration: values.rampDuration, holdDuration: values.holdDuration,
      effectiveAt: eventTime, expiresAt: new Date(+eventTime + values.expiresInMs), updatedBy: String(actorId),
      reason: values.reason, deviceStarts: deviceStarts(timeline), releasedAt: undefined,
    });
    await override.save();
    await appendAudit(override, "CHANGED", actorId, eventTime, values.reason);
    return toPlain(override);
  });
}

async function releaseOverride({ overrideId, actorId, reason, manager }) {
  const found = await SimulatorOverride.findOne({ overrideId });
  if (!found) throw fail(404, "Simulator override not found");
  return withBatchLock(found.batchId, async () => {
    const override = await SimulatorOverride.findOne({ overrideId });
    if (!override) throw fail(404, "Simulator override not found");
    if (override.status === "RELEASED" || override.status === "EXPIRED") return { ...toPlain(override), alreadyClosed: true };
    const timeline = manager.getShipmentTimeline(override.shipmentId);
    const why = String(reason || "Operator returned shipment to automatic simulation.").trim();
    if (why.length > 500) throw fail(400, "Release reason must be 500 characters or fewer");
    return toPlain(await closeOverride(override, "RELEASED", timeline.eventTime, actorId, why));
  });
}

async function listOverrides({ shipmentId, status, limit = 100 }) {
  const filter = {};
  if (shipmentId) filter.shipmentId = shipmentId;
  if (status && status !== "ALL") filter.status = status;
  return SimulatorOverride.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
}

function seededNoise(seed, overrideId, timestamp, field, amplitude) {
  const hash = createHash("sha256").update([seed, overrideId, timestamp, field].join("\u001f")).digest();
  const unit = hash.readUInt32BE(0) / 0xffffffff;
  return (unit * 2 - 1) * amplitude;
}
function round(value) { return Math.round(value * 1000) / 1000; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function tagged(reading, source, operatorUserId, overrideId = null) {
  const tag = { source, operatorUserId: String(operatorUserId || ""), overrideId: overrideId || null };
  return { ...reading, ...tag, simulation: { ...reading.simulation, telemetrySource: source,
    operatorUserId: tag.operatorUserId, overrideId: tag.overrideId } };
}
async function applyOverrideToReading(reading, { operatorUserId }) {
  const automatic = () => tagged(reading, "auto-simulated", operatorUserId);
  if (!reading.shipmentId) return automatic();
  const override = await SimulatorOverride.findOne({ shipmentId: reading.shipmentId, status: "ACTIVE", mode: "manual" });
  if (!override) return automatic();
  const timestamp = new Date(reading.timestamp);
  const effectiveAt = new Date(override.effectiveAt || override.createdAt);
  if (+timestamp < +effectiveAt) return automatic();
  const endAt = Math.min(+new Date(override.expiresAt), behaviorEnd(override));
  if (+timestamp >= endAt) {
    await closeOverride(override, "EXPIRED", timestamp, "SYSTEM", "Override duration elapsed on the simulation clock.");
    return automatic();
  }
  const deviceId = reading.deviceId;
  let starts = override.deviceStarts?.get(deviceId) || {};
  if (!Number.isFinite(starts.temperature) || !Number.isFinite(starts.humidity)) {
    starts = { temperature: Number.isFinite(starts.temperature) ? starts.temperature : reading.temperature,
      humidity: Number.isFinite(starts.humidity) ? starts.humidity : reading.humidity };
    override.deviceStarts.set(deviceId, starts);
    await override.save();
  }
  const elapsed = Math.max(0, +timestamp - +effectiveAt);
  const progress = override.behavior === "ramp" && override.rampDuration > 0
    ? Math.min(1, elapsed / (override.rampDuration * 60000)) : 1;
  const result = { ...reading };
  if (override.effect === "SENSOR_FAULT") {
    result.temperature = null;
    result.humidity = null;
    result.simulation = { ...reading.simulation, sensorFault: true };
  } else {
    const fields = [["targetTemperature", "temperature", -40, 60, 0.1], ["targetHumidity", "humidity", 0, 100, 0.4]];
    for (const [targetKey, readingKey, min, max, amplitude] of fields) {
      if (typeof override[targetKey] !== "number") continue;
      const start = Number.isFinite(starts[readingKey]) ? starts[readingKey] : reading[readingKey];
      const interpolated = override.behavior === "ramp" ? start + (override[targetKey] - start) * progress : override[targetKey];
      const noise = seededNoise(reading.simulation?.seed || "1", override.overrideId, timestamp.toISOString(), readingKey, amplitude);
      result[readingKey] = round(clamp(interpolated + noise, min, max));
    }
  }
  return tagged(result, "manual-override", override.updatedBy || override.createdBy, override.overrideId);
}

module.exports = { listPresets, ttlLimits, resolveValues, createOverride, modifyOverride, releaseOverride,
  listOverrides, applyOverrideToReading, HARD_MAX_TTL_MS };
