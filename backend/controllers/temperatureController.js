const TemperatureLog = require("../models/TemperatureLog");
const { persistTemperatureLogs } = require("../services/telemetryService");

const { normalizeOrCreateCorrelationId } = require("../services/correlationContext");
const logger = require("../services/structuredLogger");
const { tempSchema, validateTelemetry } = require("../services/telemetryValidation");

async function ingestTelemetryPayload(input, options = {}) {
  const payload = Array.isArray(input) ? input : [input];
  const { error, value } = validateTelemetry(payload);
  if (error) {
    const failure = Object.assign(new Error(error.details.map((detail) => detail.message).join("; ")), { status: 400 });
    throw failure;
  }
  const headerCorrelationId = options.correlationId ? normalizeOrCreateCorrelationId(options.correlationId) : null;
  const withCorrelation = value.map(reading => ({
    ...reading,
    correlationId: normalizeOrCreateCorrelationId(headerCorrelationId || reading.correlationId),
  }));
  logger.info("telemetry.ingestion.accepted", { correlationId: headerCorrelationId || withCorrelation[0]?.correlationId,
    readingCount: withCorrelation.length, transport: options.transport || "http" });
  return persistTemperatureLogs(withCorrelation);
}

exports.ingestLog = async (req, res) => {
  try {
    const docs = await ingestTelemetryPayload(req.body, { correlationId: req.correlationId, transport: "http" });
    res.json(docs);
  } catch (err) {
    logger.warn("telemetry.ingestion.rejected", { correlationId: req.correlationId, statusCode: err.status || 500 });
    res.status(err.status || 500).json({ error: err.message });
  }
};

exports.ingestTelemetryPayload = ingestTelemetryPayload;
exports.tempSchema = tempSchema;

exports.getLogs = async (_req, res) => {
  try {
    const logs = await TemperatureLog.find().sort({ recordedAt: -1 }).limit(200);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
