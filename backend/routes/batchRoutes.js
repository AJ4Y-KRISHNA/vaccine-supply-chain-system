const express = require("express");
const router = express.Router();

const { createBatch, verifyBatch, getBatchLifecycle } = require("../controllers/batchController");
const { requireIdentity, protectOperation } = require("../middleware/coldChainAccess");
const { scopeData, batchRead } = require("../middleware/identityScope");
router.use(requireIdentity, scopeData);

router.post("/create", requireIdentity, protectOperation(["admin", "manufacturer"], createBatch, { allowNewBatch: true, newBatchOnly: true }));

router.get("/verify/:batchId", batchRead, verifyBatch);
router.get("/:batchId/lifecycle", batchRead, getBatchLifecycle);
router.get("/:batchId/audit-anchors", batchRead, async (req, res) => {
  try { res.json({ entries: await require("../services/auditAnchoring").inspectBatch(req.params.batchId) }); }
  catch (_) { res.status(503).json({ error: "Audit anchor inspection unavailable" }); }
});

module.exports = router;
