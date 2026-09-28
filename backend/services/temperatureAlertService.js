const Alert = require("../models/TemperatureAlert");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Policy = require("../models/ColdChainPolicy");
const State = require("../models/TelemetryState");
const { withBatchLock } = require("./coldChainLock");
const { audit, notify, quarantine, normaliseKey } = require("./coldChainActions");
const buildExcursionKey = (r) => JSON.stringify([r.batchId || "", r.shipmentId || "", r.deviceId || r.sensorId || ""]);
const round = (v) => Number(v.toFixed(3));
const numeric = (v) => typeof v === "number" && Number.isFinite(v);

function evaluateTemperature({ temperature, policy }) {
  if (!numeric(temperature)) throw new Error("Temperature reading must be a finite number");
  const deviation = temperature < policy.minimumTemperature ? policy.minimumTemperature - temperature
    : temperature > policy.maximumTemperature ? temperature - policy.maximumTemperature : 0;
  const violationType = temperature < policy.minimumTemperature ? "LOW_TEMPERATURE"
    : temperature > policy.maximumTemperature ? "HIGH_TEMPERATURE" : "NORMAL";
  return { violationType, deviation: round(deviation), severity: violationType === "NORMAL" ? "NORMAL" : "WARNING" };
}

function evaluateHumidity({ humidity, policy }) {
  if (!numeric(humidity)) throw new Error("Humidity reading must be a finite number");
  if (!numeric(policy.minimumHumidity) || !numeric(policy.maximumHumidity)) {
    return { violationType: "NOT_CONFIGURED", deviation: 0, severity: "NORMAL" };
  }
  const deviation = humidity < policy.minimumHumidity ? policy.minimumHumidity - humidity
    : humidity > policy.maximumHumidity ? humidity - policy.maximumHumidity : 0;
  const violationType = humidity < policy.minimumHumidity ? "LOW_HUMIDITY"
    : humidity > policy.maximumHumidity ? "HIGH_HUMIDITY" : "NORMAL";
  return { violationType, deviation: round(deviation), severity: violationType === "NORMAL" ? "NORMAL" : "WARNING" };
}

async function updateEvent({ reading, state, policy, category, type, reasons, duration = 0, sustained = false, rate = null, shipment, healthLimited = false, closeReason }) {
  const key = `${state.streamKey}:${category}`;
  let alert = await Alert.findOne({ activeExcursionKey: key });
  const timestamp = new Date(reading.timestamp);
  const currentReading = { temperature: reading.temperature, humidity: reading.humidity, timestamp };
  if (!reasons.length) {
    if (!alert) return null;
    alert.excursionClosedAt = timestamp;
    alert.activeExcursionKey = undefined;
    alert.latestReadingAt = timestamp;
    alert.timestamp = timestamp;
    alert.currentTemperature = reading.temperature;
    alert.currentHumidity = reading.humidity;
    alert.currentReading = currentReading;
    alert.reason = `${closeReason || `Latest reading is within the approved ${category.toLowerCase()} rules.`} Previous event: ${alert.reason}`;
    alert.phase = alert.requiresQualityReview ? "QUARANTINED" : "RECOVERED";
    alert.recommendedAction = alert.requiresQualityReview ? "Hold remains in place. Request quality review and clearance." : "Continue monitoring.";
    if (!alert.requiresQualityReview) { alert.status = "RESOLVED"; alert.resolvedAt = timestamp; alert.resolvedBy = "SYSTEM"; }
    await alert.save();
    await audit(alert, "EXCURSION_CLOSED", "SYSTEM", alert.reason, timestamp);
    return alert;
  }
  const created = !alert;
  if (!alert) alert = new Alert({
    batchId: reading.batchId, shipmentId: reading.shipmentId || "", deviceId: reading.deviceId || "",
    vehicleId: reading.vehicleId || "", manufacturer: reading.manufacturer,
    manufacturerKey: normaliseKey(reading.manufacturer), activeExcursionKey: key,
    excursionStartedAt: timestamp, engineVersion: "cold-chain-rules-v1", policyId: policy._id,
    policySnapshot: policy, vaccineType: policy.vaccineType,
  });
  const reliability = category === "RELIABILITY";
  const phase = sustained ? "QUARANTINED" : reliability ? "RELIABILITY_ISSUE" : "REVIEW_REQUIRED";
  alert.currentTemperature = reading.temperature;
  alert.currentHumidity = reading.humidity;
  alert.currentReading = currentReading;
  alert.vaccineType = policy.vaccineType;
  if (category === "TEMPERATURE") {
    alert.metric = "TEMPERATURE";
    alert.minimumAllowedTemperature = policy.minimumTemperature;
    alert.maximumAllowedTemperature = policy.maximumTemperature;
    alert.breachedLimit = type === "LOW_TEMPERATURE" ? policy.minimumTemperature : policy.maximumTemperature;
  } else if (category === "HUMIDITY") {
    alert.metric = "HUMIDITY";
    alert.minimumAllowedHumidity = policy.minimumHumidity;
    alert.maximumAllowedHumidity = policy.maximumHumidity;
    alert.breachedLimit = type === "LOW_HUMIDITY" ? policy.minimumHumidity : policy.maximumHumidity;
  } else {
    alert.metric = "RELIABILITY";
  }
  alert.violationType = type;
  alert.severity = sustained || alert.requiresQualityReview ? "CRITICAL" : "WARNING";
  alert.reasons = reasons;
  alert.reason = reasons.join(" ");
  alert.timestamp = timestamp;
  alert.latestReadingAt = timestamp;
  alert.latitude = reading.latitude;
  alert.longitude = reading.longitude;
  alert.temperatureLogId = reading.temperatureLogId;
  alert.excursionDurationMs = duration;
  if (category === "TEMPERATURE" && numeric(reading.temperature)) {
    alert.minimumExcursionTemperature = Math.min(alert.minimumExcursionTemperature ?? reading.temperature, reading.temperature);
    alert.maximumExcursionTemperature = Math.max(alert.maximumExcursionTemperature ?? reading.temperature, reading.temperature);
  }
  if (category === "HUMIDITY" && numeric(reading.humidity)) {
    alert.minimumExcursionHumidity = Math.min(alert.minimumExcursionHumidity ?? reading.humidity, reading.humidity);
    alert.maximumExcursionHumidity = Math.max(alert.maximumExcursionHumidity ?? reading.humidity, reading.humidity);
  }
  alert.phase = alert.requiresQualityReview ? "QUARANTINED" : phase;
  alert.recommendedAction = alert.requiresQualityReview ? "Hold remains in place. Request quality review and clearance." : reliability ? "Check device/simulation and request another reading."
    : sustained ? "Quarantine shipment and request quality review." : "Review required; request another reading.";
  alert.confidence = {
    level: reliability || healthLimited || !numeric(reading.batteryLevel) ? "LIMITED" : "HIGH",
    basis: "Rule evidence completeness, not a probability of vaccine safety or an ML score.",
  };
  alert.context = { humidity: reading.humidity, batteryLevel: reading.batteryLevel, rateCelsiusPerMinute: rate,
    vaccineType: policy.vaccineType, shipmentStatus: shipment?.status || "Unknown", source: reading.source,
    overrideId: reading.overrideId, operatorUserId: reading.operatorUserId };
  await alert.save();
  if (created) await audit(alert, "EVENT_OPENED", "SYSTEM", alert.reason, timestamp, { policyId: policy._id, context: alert.context });
  if (sustained) await quarantine(alert, "SYSTEM", alert.reason, timestamp);
  else await notify(alert, alert.phase);
  return alert;
}

async function evaluateReading(reading, temperatureLogId) {
  if (!reading.batchId) return { evaluated: false, policyStatus: "BATCH_NOT_ASSOCIATED" };
  return withBatchLock(reading.batchId, async () => {
    const batch = await Batch.findOne({ batchId: reading.batchId }).lean();
    const policy = batch?.coldChainPolicyId ? await Policy.findById(batch.coldChainPolicyId).lean() : null;
    if (!policy || policy.batchId !== batch.batchId) return { evaluated: false, policyStatus: "POLICY_NOT_APPROVED" };
    if (policy.vaccineType !== batch.vaccineType) return { evaluated: false, policyStatus: "POLICY_PRODUCT_MISMATCH" };
    const shipment = reading.shipmentId ? await Shipment.findOne({ shipmentId: reading.shipmentId }).lean() : null;
    if (reading.shipmentId && (!shipment || shipment.batchId !== batch.batchId)) return { evaluated: false, policyStatus: "SHIPMENT_BATCH_MISMATCH" };
    const timestamp = new Date(reading.timestamp);
    if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid reading timestamp");
    reading = { ...reading, manufacturer: batch.manufacturer, temperatureLogId,
      source: reading.simulation?.telemetrySource || reading.simulation?.source || "temperature-ingestion",
      overrideId: reading.simulation?.overrideId || reading.overrideId,
      operatorUserId: reading.simulation?.operatorUserId || reading.operatorUserId };
    const streamKey = buildExcursionKey(reading);
    let state = await State.findOne({ streamKey });
    if (state && (timestamp <= state.lastReadingAt || timestamp < state.checkedAt)) return { evaluated: false, policyStatus: "STALE_OR_DUPLICATE_READING" };
    if (!state) state = new State({ streamKey, batchId: reading.batchId, deviceId: reading.deviceId,
      shipmentId: reading.shipmentId, vehicleId: reading.vehicleId });
    const gap = state.lastReadingAt ? timestamp - state.lastReadingAt : 0;
    const gapExceeded = gap > policy.maximumReadingGapMs;
    const samePolicy = String(state.policyId) === String(policy._id);
    const rate = gap > 0 && numeric(state.temperature) ? round((reading.temperature - state.temperature) / (gap / 60000)) : null;
    const evaluation = evaluateTemperature({ temperature: reading.temperature, policy });
    const abnormal = evaluation.violationType !== "NORMAL";
    const humidityConfigured = numeric(policy.minimumHumidity) && numeric(policy.maximumHumidity);
    const humidityEvaluation = humidityConfigured && numeric(reading.humidity)
      ? evaluateHumidity({ humidity: reading.humidity, policy })
      : null;
    const humidityType = humidityEvaluation?.violationType || "NORMAL";
    const humidityAbnormal = humidityType === "LOW_HUMIDITY" || humidityType === "HIGH_HUMIDITY";
    if (state.lastReadingAt && state.temperatureDirection !== "NORMAL" && (gapExceeded || !samePolicy || abnormal && state.temperatureDirection !== evaluation.violationType)) {
      await updateEvent({ reading, state, policy, category: "TEMPERATURE", reasons: [],
        closeReason: "Prior continuous excursion ended: gap, policy revision, or excursion direction changed; continuous exposure is not inferred across this boundary." });
    }
    if (state.lastReadingAt && state.humidityDirection && state.humidityDirection !== "NORMAL" &&
      (gapExceeded || !samePolicy || !humidityAbnormal || state.humidityDirection !== humidityType)) {
      await updateEvent({ reading, state, policy, category: "HUMIDITY", reasons: [],
        closeReason: "Prior continuous humidity excursion ended: the measurement returned in range, became unavailable, the gap exceeded policy, or the policy revision changed." });
    }
    if (abnormal && (!state.temperatureSince || gapExceeded || !samePolicy || state.temperatureDirection !== evaluation.violationType)) state.temperatureSince = timestamp;
    if (!abnormal) state.temperatureSince = undefined;
    state.temperatureDirection = evaluation.violationType;
    const duration = abnormal ? timestamp - state.temperatureSince : 0;
    const sustained = abnormal && duration >= policy.excursionDurationMs;
    const reasons = abnormal ? [
      `${sustained ? "Critical" : "Review required"}: ${reading.temperature}°C is ${evaluation.deviation}°C ${evaluation.violationType === "HIGH_TEMPERATURE" ? "above the approved maximum" : "below the approved minimum"} of ${evaluation.violationType === "HIGH_TEMPERATURE" ? policy.maximumTemperature : policy.minimumTemperature}°C for ${round(duration / 60000)} consecutive measured minutes.`,
    ] : [];
    if (humidityAbnormal && (!state.humiditySince || gapExceeded || !samePolicy || state.humidityDirection !== humidityType)) state.humiditySince = timestamp;
    if (!humidityAbnormal) state.humiditySince = undefined;
    state.humidityDirection = humidityType;
    const humidityDuration = humidityAbnormal ? timestamp - state.humiditySince : 0;
    const humiditySustained = humidityAbnormal && humidityDuration >= policy.excursionDurationMs;
    const humidityLimit = humidityType === "LOW_HUMIDITY" ? policy.minimumHumidity : policy.maximumHumidity;
    const humiditySide = humidityType === "LOW_HUMIDITY" ? "below the approved minimum" : "above the approved maximum";
    const humidityReasons = humidityAbnormal ? [
      `${humiditySustained ? "Critical" : "Review required"}: Humidity ${reading.humidity}% is ${humidityEvaluation.deviation}% ${humiditySide} of ${humidityLimit}% for ${round(humidityDuration / 60000)} consecutive measured minutes.`,
    ] : [];
    const health = [];
    if (!reading.deviceId) health.push("Device identifier is missing; telemetry cannot be attributed to a sensor.");
    if (gapExceeded) health.push(`Reading gap ${gap}ms exceeded the approved ${policy.maximumReadingGapMs}ms; continuous exposure is unknown.`);
    if (!numeric(reading.batteryLevel)) health.push("Battery state was not supplied; device health is unknown.");
    else if (reading.batteryLevel <= policy.criticalBatteryPercent) health.push(`Battery ${reading.batteryLevel}% is at or below the configured ${policy.criticalBatteryPercent}% limit.`);
    if (rate !== null && Math.abs(rate) > policy.maximumRateCelsiusPerMinute) health.push(`Temperature changed at ${rate}°C/min, exceeding the configured ${policy.maximumRateCelsiusPerMinute}°C/min plausibility limit.`);
    if (humidityConfigured && !numeric(reading.humidity)) health.push("Humidity is missing for a policy that requires humidity monitoring.");
    const shared = { reading, state, policy, shipment, rate, healthLimited: health.length > 0 };
    const temperatureAlert = await updateEvent({ ...shared, category: "TEMPERATURE", type: evaluation.violationType, reasons, duration, sustained });
    const humidityAlert = await updateEvent({ ...shared, category: "HUMIDITY", type: humidityType === "NORMAL" ? "HUMIDITY" : humidityType,
      reasons: humidityReasons, duration: humidityDuration, sustained: humiditySustained });
    const healthAlert = await updateEvent({ ...shared, category: "RELIABILITY", type: "TELEMETRY_RELIABILITY", reasons: health });
    Object.assign(state, { lastReadingAt: timestamp, checkedAt: timestamp, policyId: policy._id,
      temperature: reading.temperature, humidity: reading.humidity, batteryLevel: reading.batteryLevel,
      latitude: reading.latitude, longitude: reading.longitude, source: reading.source });
    await state.save();
    const anySustained = sustained || humiditySustained;
    const held = anySustained || !!(await Alert.exists({ batchId: batch.batchId, requiresQualityReview: true }));
    return { evaluated: true, policyStatus: "APPROVED", ...evaluation, severity: anySustained ? "CRITICAL" : (abnormal || humidityAbnormal || health.length) ? "WARNING" : "NORMAL", batchQuarantined: held,
      affected: { batchId: batch.batchId, shipmentId: reading.shipmentId || "", deviceId: reading.deviceId || "" },
      notificationTargets: [...new Set([temperatureAlert, humidityAlert, healthAlert].filter(Boolean).flatMap(a => a.notificationTargets || []))],
      alertIds: [temperatureAlert, humidityAlert, healthAlert].filter(Boolean).map(a => a.alertId),
      confidence: health.length ? "LIMITED" : "HIGH", reasons: [...reasons, ...humidityReasons, ...health],
      recommendedAction: held ? "QUARANTINE_PENDING_REVIEW" : abnormal || humidityAbnormal ? "REQUEST_READING" : health.length ? "CHECK_DEVICE" : "RECORD_NORMAL" };
  });
}

async function checkMissingTelemetry(batchId, asOf, expectedDevice = null) {
  return withBatchLock(batchId, async () => {
    const batch = await Batch.findOne({ batchId }).lean();
    if (!batch?.coldChainPolicyId) return [];
    const policy = await Policy.findById(batch.coldChainPolicyId).lean();
    if (!policy || policy.batchId !== batchId || policy.vaccineType !== batch.vaccineType) return [];
    const timestamp = new Date(asOf);
    if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid simulation check time");
    if (expectedDevice) {
      const streamKey = buildExcursionKey({ batchId, ...expectedDevice });
      await State.updateOne({ streamKey }, { $setOnInsert: { streamKey, batchId,
        deviceId: expectedDevice.deviceId, shipmentId: expectedDevice.shipmentId || "", expectedSince: new Date(expectedDevice.expectedSince),
        source: "software-iot-simulator", policyId: policy._id } }, { upsert: true });
    }
    const states = await State.find({ batchId, ...(expectedDevice ? { deviceId: expectedDevice.deviceId, shipmentId: expectedDevice.shipmentId || "" } : {}) });
    const alerts = [];
    for (const state of states) {
      const baseline = state.lastReadingAt || state.expectedSince;
      if (!baseline || timestamp <= state.checkedAt || timestamp - baseline <= policy.maximumReadingGapMs) continue;
      const reading = { ...state.toObject(), timestamp, manufacturer: batch.manufacturer };
      const alert = await updateEvent({ reading, state, policy, category: "RELIABILITY", type: "TELEMETRY_RELIABILITY",
        reasons: [`${state.lastReadingAt ? "Sensor reading missing" : "First expected sensor reading missing"} for ${timestamp - baseline}ms; approved gap is ${policy.maximumReadingGapMs}ms. Check device/simulation.`] });
      state.checkedAt = timestamp;
      state.temperatureSince = undefined;
      await state.save();
      alerts.push(alert);
    }
    return alerts;
  });
}
module.exports = { evaluateTemperature, evaluateHumidity, processSimulatedTemperatureReading: evaluateReading, evaluateReading,
  checkMissingTelemetry, buildExcursionKey, normaliseKey };
