const express = require("express");
const { requireIdentity, authorizeSimulator } = require("../middleware/coldChainAccess");
const {
  createVirtualDevice,
  startSimulation,
  stopSimulation,
  tickSimulation,
  resetSimulation,
  changeScenario,
  getSimulationStatus,
  getSimulatorStatus,
} = require("../controllers/simulatorController");

const router = express.Router();

// Real current identities are required even when AUTH_OPTIONAL is enabled elsewhere.
router.use(requireIdentity);
router.use(async (_req, res, next) => {
  try { await require("../controllers/simulatorController").simulatorManager.initialize(); next(); }
  catch (_) { res.status(503).json({ error: "Unable to load durable simulator state" }); }
});
router.get("/inputs", authorizeSimulator, require("../middleware/identityScope").scopeData, require("../controllers/simulatorController").getInputs);
router.post("/devices", authorizeSimulator, createVirtualDevice);
router.post("/:deviceId/start", authorizeSimulator, startSimulation);
router.post("/:deviceId/stop", authorizeSimulator, stopSimulation);
router.post("/:deviceId/tick", authorizeSimulator, tickSimulation);
router.post("/:deviceId/reset", authorizeSimulator, resetSimulation);
router.post("/:deviceId/scenario", authorizeSimulator, changeScenario);
router.post("/:deviceId/monitor", authorizeSimulator, require("../controllers/simulatorController").setMonitoring);
router.get("/:deviceId/status", authorizeSimulator, getSimulationStatus);
router.get("/status", authorizeSimulator, getSimulatorStatus);

module.exports = router;
