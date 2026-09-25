const TemperatureLog = require("../models/TemperatureLog");
const { persistTemperatureLogs } = require("../services/telemetryService");

const Joi = require("joi");

const tempSchema = Joi.array().items(
  Joi.object({
    shipmentId: Joi.string().allow(""),
    batchId: Joi.string().allow(""),
    sensorId: Joi.string().allow(""),
    deviceId: Joi.string().allow(""),
    vehicleId: Joi.string().allow(""),
    sequenceNumber: Joi.number().integer().min(0),
    temperature: Joi.number().min(-100).max(100).required(),
    humidity: Joi.number().min(0).max(100),
    batteryLevel: Joi.number().min(0).max(100),
    recordedAt: Joi.date().iso(),
    status: Joi.string().valid("Normal", "Alert").default("Normal"),
    location: Joi.object({
      lat: Joi.number(),
      lng: Joi.number(),
    }).optional(),
    simulation: Joi.object({
      source: Joi.string().allow(""),
      scenario: Joi.string().allow(""),
      seed: Joi.string().allow(""),
      tick: Joi.number().integer().min(0),
    }).optional(),
  })
);

exports.ingestLog = async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : [req.body];
    const { error, value } = tempSchema.validate(payload, { abortEarly: false });
    if (error) return res.status(400).json({ error: error.details.map((d) => d.message) });

    const docs = await persistTemperatureLogs(value);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLogs = async (_req, res) => {
  try {
    const logs = await TemperatureLog.find().sort({ recordedAt: -1 }).limit(200);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
