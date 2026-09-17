const Joi = require("joi");
const {
  DEFAULT_START_TIME,
  DEFAULT_TICK_INTERVAL_MS,
  SCENARIOS,
  SimulationNotFoundError,
  SimulatorManager,
} = require("../services/iotSimulator");
const { persistSimulationReading } = require("../services/telemetryService");

const simulatorManager = new SimulatorManager();

const routePointSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
});

const deviceSchema = Joi.object({
  deviceId: Joi.string().trim().max(120).required(),
  vehicleId: Joi.string().trim().max(120).allow(""),
  batchId: Joi.string().trim().max(120).allow(""),
  shipmentId: Joi.string().trim().max(120).allow(""),
  scenario: Joi.string().uppercase().valid(...SCENARIOS).default("NORMAL"),
  seed: Joi.alternatives().try(Joi.string().max(200), Joi.number()).default("1"),
  startTime: Joi.date().iso().default(DEFAULT_START_TIME),
  tickIntervalMs: Joi.number().integer().min(10).max(3600000).default(DEFAULT_TICK_INTERVAL_MS),
  route: Joi.array().items(routePointSchema).min(2).max(1000),
  temperatureRange: Joi.object({
    min: Joi.number().min(-100).max(100).required(),
    max: Joi.number().min(-100).max(100).greater(Joi.ref("min")).required(),
  }),
  initialBatteryLevel: Joi.number().min(0).max(100),
});

function sendError(res, error) {
  if (error instanceof SimulationNotFoundError) {
    return res.status(404).json({ error: error.message });
  }

  return res.status(error.status || 500).json({ error: error.message || "Simulator operation failed" });
}

exports.createVirtualDevice = (req, res) => {
  const { error, value } = deviceSchema.validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({ error: error.details.map((detail) => detail.message) });

  try {
    const simulation = simulatorManager.createDevice(value);
    return res.status(201).json({ message: "Virtual device created", simulation });
  } catch (simulatorError) {
    return sendError(res, simulatorError);
  }
};

exports.startSimulation = (req, res) => {
  try {
    const simulation = simulatorManager.start(req.params.deviceId, persistSimulationReading);
    return res.json({ message: "Simulation started", simulation });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.stopSimulation = (req, res) => {
  try {
    const simulation = simulatorManager.stop(req.params.deviceId);
    if (!simulation) return res.status(404).json({ error: `Virtual device '${req.params.deviceId}' was not found` });
    return res.json({ message: "Simulation stopped", simulation });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.tickSimulation = async (req, res) => {
  try {
    const result = await simulatorManager.tickOnce(req.params.deviceId, persistSimulationReading);
    return res.json({ message: "Simulation tick persisted", ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.resetSimulation = (req, res) => {
  try {
    const simulation = simulatorManager.reset(req.params.deviceId);
    return res.json({ message: "Simulation reset and stopped", simulation });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.changeScenario = (req, res) => {
  const { error, value } = Joi.object({ scenario: Joi.string().uppercase().valid(...SCENARIOS).required() }).validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try { return res.json({ simulation: simulatorManager.setScenario(req.params.deviceId, value.scenario) }); }
  catch (simulatorError) { return sendError(res, simulatorError); }
};

exports.getSimulationStatus = (req, res) => {
  try {
    const simulation = simulatorManager.getStatus(req.params.deviceId);
    return res.json({ simulation });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getSimulatorStatus = async (req, res) => {
  try {
    let simulations = simulatorManager.getAllStatuses();
    if (req.user.role !== "admin") {
      const keys = [req.user.email, req.user.manufacturer].filter(Boolean).map(value => value.trim().toLowerCase());
      const batches = await require("../models/Batch").find({ batchId: { $in: simulations.map(s => s.batchId) } }).lean();
      const permitted = new Set(batches.filter(b => keys.includes(String(b.manufacturer || "").trim().toLowerCase())).map(b => b.batchId));
      simulations = simulations.filter(s => permitted.has(s.batchId));
    }
    res.json({ simulations });
  } catch (error) { sendError(res, error); }
};

exports.simulatorManager = simulatorManager;
exports.deviceSchema = deviceSchema;
