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
router.post("/devices", authorizeSimulator, createVirtualDevice);
router.post("/:deviceId/start", authorizeSimulator, startSimulation);
router.post("/:deviceId/stop", authorizeSimulator, stopSimulation);
router.post("/:deviceId/tick", authorizeSimulator, tickSimulation);
router.post("/:deviceId/reset", authorizeSimulator, resetSimulation);
router.post("/:deviceId/scenario", authorizeSimulator, changeScenario);
router.get("/:deviceId/status", authorizeSimulator, getSimulationStatus);
router.get("/status", authorizeSimulator, getSimulatorStatus);

module.exports = router;
