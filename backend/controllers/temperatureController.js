const TemperatureLog = require("../models/TemperatureLog");

const Joi = require("joi");

const tempSchema = Joi.array().items(
  Joi.object({
    shipmentId: Joi.string().allow(""),
    batchId: Joi.string().allow(""),
    sensorId: Joi.string().allow(""),
    temperature: Joi.number().min(-100).max(100).required(),
    status: Joi.string().valid("Normal", "Alert").default("Normal"),
    location: Joi.object({
      lat: Joi.number(),
      lng: Joi.number(),
    }).optional(),
  })
);

exports.ingestLog = async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : [req.body];
    const { error, value } = tempSchema.validate(payload, { abortEarly: false });
    if (error) return res.status(400).json({ error: error.details.map((d) => d.message) });

    const docs = await TemperatureLog.insertMany(value);
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
