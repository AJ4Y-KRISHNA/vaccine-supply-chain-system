const express = require("express");
const router = express.Router();

const { createBatch, verifyBatch, getBatchLifecycle, getBatchVerificationPayload, getBatchOnChainTelemetry } = require("../controllers/batchController");
const { getJourney: getBatchStory } = require("../controllers/traceabilityController");
const { updateBatchDisposition } = require("../controllers/batchDispositionController");
const { requireIdentity, protectOperation } = require("../middleware/coldChainAccess");
const { scopeData, batchRead } = require("../middleware/identityScope");
router.use(requireIdentity, scopeData);

router.post("/create", requireIdentity, protectOperation(["admin", "manufacturer"], createBatch, { allowNewBatch: true, newBatchOnly: true }));
router.post("/", requireIdentity, protectOperation(["manufacturer"], createBatch, { allowNewBatch: true, newBatchOnly: true }));

router.patch("/:batchId/disposition", batchRead, updateBatchDisposition);
router.get("/:batchId/story", batchRead, getBatchStory);
router.get("/:batchId/verification-payload", batchRead, getBatchVerificationPayload);
router.get("/:batchId/on-chain-telemetry", batchRead, getBatchOnChainTelemetry);
router.get("/verify/:batchId", batchRead, verifyBatch);
router.get("/:batchId/lifecycle", batchRead, getBatchLifecycle);
router.get("/:batchId/audit-anchors", batchRead, async (req, res) => {
  try { res.json({ entries: await require("../services/auditAnchoring").inspectBatch(req.params.batchId) }); }
  catch (_) { res.status(503).json({ error: "Audit anchor inspection unavailable" }); }
});

module.exports = router;
