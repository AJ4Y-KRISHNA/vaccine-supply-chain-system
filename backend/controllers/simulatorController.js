const Joi = require("joi");
const {
  DEFAULT_START_TIME,
  DEFAULT_TICK_INTERVAL_MS,
  SCENARIOS,
  SimulationNotFoundError,
} = require("../services/iotSimulator");
const { postSimulationReading } = require("../services/simulatorTelemetryTransport");

const { DurableSimulatorManager } = require("../services/durableSimulator");
const simulatorManager = new DurableSimulatorManager();

const routePointSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
});

const deviceSchema = Joi.object({
  deviceId: Joi.string().trim().max(120).required(),
  vehicleId: Joi.string().trim().max(120).allow(""),
  batchId: Joi.string().trim().max(120).allow(""),
  shipmentId: Joi.string().trim().max(120).allow(""),
  scenario: Joi.string().uppercase().valid(...SCENARIOS).default(process.env.SIMULATOR_SCENARIO || "NORMAL"),
  seed: Joi.alternatives().try(Joi.string().max(200), Joi.number()).default(process.env.SIMULATOR_SEED || "1"),
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

exports.createVirtualDevice = async (req, res) => {
  const { error, value } = deviceSchema.validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({ error: error.details.map((detail) => detail.message) });

  try {
    const simulation = await simulatorManager.createDevice(value, req.user.id);
    return res.status(201).json({ message: "Virtual device created", simulation });
  } catch (simulatorError) {
    return sendError(res, simulatorError);
  }
};

exports.startSimulation = async (req, res) => {
  try {
    const simulation = await simulatorManager.start(req.params.deviceId, postSimulationReading, req.user.id);
    return res.json({ message: "Simulation started", simulation });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.stopSimulation = async (req, res) => {
  try {
    const simulation = await simulatorManager.stop(req.params.deviceId);
    if (!simulation) return res.status(404).json({ error: `Virtual device '${req.params.deviceId}' was not found` });
    return res.json({ message: "Simulation stopped", simulation });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.tickSimulation = async (req, res) => {
  try {
    const result = await simulatorManager.tickOnce(req.params.deviceId, postSimulationReading, req.user.id);
    return res.json({ message: "Simulation tick persisted", ...result });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.resetSimulation = async (req, res) => {
  try {
    const simulation = await simulatorManager.reset(req.params.deviceId);
    return res.json({ message: "Simulation reset and stopped", simulation });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.changeScenario = async (req, res) => {
  const { error, value } = Joi.object({ scenario: Joi.string().uppercase().valid(...SCENARIOS).required() }).validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try { return res.json({ simulation: await simulatorManager.setScenario(req.params.deviceId, value.scenario) }); }
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
    res.json({ simulations, monitor: require("../services/telemetryWatchdog").getHealth() });
  } catch (error) { sendError(res, error); }
};

exports.simulatorManager = simulatorManager;
exports.deviceSchema = deviceSchema;
exports.setMonitoring = async (req, res) => {
  const { error, value } = Joi.object({ enabled: Joi.boolean().strict().required(), asOf: Joi.string().isoDate() }).validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  try { res.json({ simulation: await simulatorManager.setMonitoring(req.params.deviceId, value.enabled, value.asOf) }); }
  catch (failure) { sendError(res, failure); }
};
exports.getInputs = async (req, res) => {
  try {
    const [batches, shipments] = await Promise.all([
      require("../models/Batch").find(req.scope.batch).select("batchId vaccineType isDemo coldChainPolicyId").lean(),
      require("../models/Shipment").find(req.scope.shipment).select("shipmentId batchId").lean(),
    ]);
    res.json({ batches, shipments, scenarios: SCENARIOS });
  } catch (error) { sendError(res, error); }
};
