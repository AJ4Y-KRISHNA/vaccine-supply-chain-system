const Joi = require("joi");
const { simulatorManager } = require("./simulatorController");
const overrides = require("../services/simulatorOverrides");

const temperature = Joi.number().min(-40).max(60).allow(null);
const humidity = Joi.number().min(0).max(100).allow(null);
const commonBody = {
  presetId: Joi.string().valid("refrigeration-failure", "door-left-open", "freezing-risk", "low-humidity", "sensor-fault"),
  targetTemperature: temperature,
  targetHumidity: humidity,
  behavior: Joi.string().valid("hold", "ramp"),
  rampDuration: Joi.number().min(0).max(1440),
  holdDuration: Joi.number().greater(0).max(1440),
  expiresInMs: Joi.number().integer().min(10).max(overrides.HARD_MAX_TTL_MS),
  reason: Joi.string().trim().min(1).max(500),
};

function sendError(res, error) {
  return res.status(error.status || 500).json({ error: error.message || "Simulator override operation failed", ...(error.code ? { code: error.code } : {}) });
}
exports.featureEnabled = (_req, res, next) => {
  if (process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED !== "true") {
    return res.status(404).json({ error: "Manual simulator overrides are disabled", code: "SIMULATOR_OVERRIDES_DISABLED" });
  }
  next();
};
exports.requireAdmin = (req, res, next) => req.user?.role === "admin"
  ? next() : res.status(403).json({ error: "Manual simulator overrides require the admin role" });

exports.getPresets = (_req, res) => res.json({ presets: overrides.listPresets(), expiry: overrides.ttlLimits() });

exports.create = async (req, res) => {
  const schema = Joi.object({ shipmentId: Joi.string().trim().min(1).max(120).required(), ...commonBody })
    .or("presetId", "targetTemperature", "targetHumidity");
  const { error, value } = schema.validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({ error: error.details.map(detail => detail.message) });
  try {
    const override = await overrides.createOverride({ input: value, actorId: req.user.id, manager: simulatorManager });
    return res.status(201).json({ message: "Manual simulator override created", override });
  } catch (failure) { return sendError(res, failure); }
};

exports.modify = async (req, res) => {
  const schema = Joi.object(commonBody).keys({ reason: Joi.string().trim().min(1).max(500).required() })
    .or("presetId", "targetTemperature", "targetHumidity", "behavior", "holdDuration", "rampDuration", "expiresInMs");
  const { error, value } = schema.validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({ error: error.details.map(detail => detail.message) });
  try {
    const override = await overrides.modifyOverride({ overrideId: req.params.id, input: value, actorId: req.user.id, manager: simulatorManager });
    return res.json({ message: "Manual simulator override updated", override });
  } catch (failure) { return sendError(res, failure); }
};

exports.release = async (req, res) => {
  const { error, value } = Joi.object({ reason: Joi.string().trim().min(1).max(500) }).validate(req.body || {}, { abortEarly: false });
  if (error) return res.status(400).json({ error: error.details.map(detail => detail.message) });
  try {
    const override = await overrides.releaseOverride({ overrideId: req.params.id, reason: value.reason, actorId: req.user.id, manager: simulatorManager });
    return res.json({ message: override.alreadyClosed ? "Override was already closed" : "Override released; simulator returned to automatic mode", override });
  } catch (failure) { return sendError(res, failure); }
};

exports.list = async (req, res) => {
  const { error, value } = Joi.object({
    shipmentId: Joi.string().trim().max(120),
    status: Joi.string().valid("ACTIVE", "RELEASED", "EXPIRED", "ALL").default("ALL"),
    limit: Joi.number().integer().min(1).max(200).default(100),
  }).validate(req.query, { abortEarly: false, convert: true });
  if (error) return res.status(400).json({ error: error.details.map(detail => detail.message) });
  try {
    const records = await overrides.listOverrides(value);
    return res.json({ overrides: records });
  } catch (failure) { return sendError(res, failure); }
};
