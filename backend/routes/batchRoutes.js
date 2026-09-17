const express = require("express");
const router = express.Router();

const { createBatch, verifyBatch, getBatchLifecycle } = require("../controllers/batchController");
const { requireIdentity, protectOperation } = require("../middleware/coldChainAccess");

router.post("/create", requireIdentity, protectOperation(["admin", "manufacturer"], createBatch, { allowNewBatch: true, newBatchOnly: true }));

router.get("/verify/:batchId", verifyBatch);
router.get("/:batchId/lifecycle", getBatchLifecycle);

module.exports = router;
