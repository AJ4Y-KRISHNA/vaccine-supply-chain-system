const Joi = require("joi");

// Shared by the Express ingestion endpoint and the separate Edge Gateway so
// both boundaries accept the same legacy and simulator payload contract.
const tempSchema = Joi.array().items(
  Joi.object({
    shipmentId: Joi.string().allow(""),
    batchId: Joi.string().allow(""),
    sensorId: Joi.string().allow(""),
    deviceId: Joi.string().allow(""),
    vehicleId: Joi.string().allow(""),
    source: Joi.string().valid("simulator", "manual", "csv", "auto-simulated", "manual-override"),
    enteredBy: Joi.string().max(128).allow(""),
    note: Joi.string().max(1000).allow(""),
    needsReview: Joi.boolean(),
    supersedes: Joi.string().hex().length(24),
    // The simulator emits explicit nulls when no operator override is active.
    overrideId: Joi.string().allow("", null),
    operatorUserId: Joi.string().allow("", null),
    correlationId: Joi.string().max(128),
    sequenceNumber: Joi.number().integer().min(0),
    edge: Joi.object({
      ewma: Joi.number(), rollingZScore: Joi.number(), rateOfChange: Joi.number(),
      rateCPerMinute: Joi.number(), flatlineSeconds: Joi.number().min(0),
      ruleProfile: Joi.string().max(200),
      gpsPlausibility: Joi.object({ flagged: Joi.boolean().required(),
        impliedSpeedKmh: Joi.number().min(0).allow(null).required(),
        maxSpeedKmh: Joi.number().positive().required(), reason: Joi.string().max(300).required() }),
      localAlert: Joi.object({ active: Joi.boolean().required(), code: Joi.string().allow(null).required(),
        reason: Joi.string().allow(null).required() }).required(),
    }),
    deviceSignature: Joi.string().hex().length(64),
    temperature: Joi.number().min(-40).max(60).required(),
    humidity: Joi.number().min(0).max(100),
    batteryLevel: Joi.number().min(0).max(100),
    recordedAt: Joi.date().iso(),
    status: Joi.string().valid("Normal", "Alert").default("Normal"),
    location: Joi.object({
      lat: Joi.number().min(-90).max(90),
      lng: Joi.number().min(-180).max(180),
    }).and("lat", "lng").optional(),
    simulation: Joi.object({
      source: Joi.string().allow(""),
      telemetrySource: Joi.string().valid("simulator", "manual", "csv", "auto-simulated", "manual-override"),
      overrideId: Joi.string().allow("", null),
      operatorUserId: Joi.string().allow("", null),
      scenario: Joi.string().allow(""),
      seed: Joi.string().allow(""),
      tick: Joi.number().integer().min(0),
      sourceSequenceNumber: Joi.number().integer().min(0).allow(null),
      linkLoss: Joi.boolean(),
    }).optional(),
  })
);

const DAY_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function validateTelemetry(input, { now = new Date() } = {}) {
  const payload = Array.isArray(input) ? input : [input];
  const checked = tempSchema.validate(payload, { abortEarly: false });
  if (checked.error) return checked;

  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError("Telemetry validation clock must be a valid date");
  const oldestAllowed = nowMs - DAY_MS;
  const newestAllowed = nowMs + FUTURE_TOLERANCE_MS;
  for (let index = 0; index < checked.value.length; index++) {
    const recordedAt = checked.value[index].recordedAt || new Date(nowMs);
    const timestamp = new Date(recordedAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp < oldestAllowed || timestamp > newestAllowed) {
      return {
        value: checked.value,
        error: {
          details: [{ message: `Telemetry timestamp at index ${index} must be within the previous 24 hours and next 5 minutes` }],
        },
      };
    }
    checked.value[index].recordedAt = new Date(timestamp);
  }
  return checked;
}

module.exports = { tempSchema, validateTelemetry, DAY_MS, FUTURE_TOLERANCE_MS };
