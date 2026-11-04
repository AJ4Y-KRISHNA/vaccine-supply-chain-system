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
const overrideController = require("../controllers/simulatorOverrideController");

// Real current identities are required even when AUTH_OPTIONAL is enabled elsewhere.
router.use(requireIdentity);
router.use((req, res, next) => process.env.DATA_MODE === "manual"
  ? res.status(409).json({ error: "Simulator is disabled in DATA_MODE=manual" }) : next());
router.use(async (_req, res, next) => {
  try { await require("../controllers/simulatorController").simulatorManager.initialize(); next(); }
  catch (_) { res.status(503).json({ error: "Unable to load durable simulator state" }); }
});
router.get("/inputs", authorizeSimulator, require("../middleware/identityScope").scopeData, require("../controllers/simulatorController").getInputs);
// Override APIs are separately gated and deliberately admin-only in this phase.
router.get("/presets", overrideController.featureEnabled, overrideController.requireAdmin, overrideController.getPresets);
router.get("/overrides", overrideController.featureEnabled, overrideController.requireAdmin, overrideController.list);
router.post("/overrides", overrideController.featureEnabled, overrideController.requireAdmin, overrideController.create);
router.patch("/overrides/:id", overrideController.featureEnabled, overrideController.requireAdmin, overrideController.modify);
router.delete("/overrides/:id", overrideController.featureEnabled, overrideController.requireAdmin, overrideController.release);
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
