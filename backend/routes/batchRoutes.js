const express = require("express");
const router = express.Router();

const { createBatch, verifyBatch, getBatchLifecycle } = require("../controllers/batchController");

router.post("/create", createBatch);

router.get("/verify/:batchId", verifyBatch);
router.get("/:batchId/lifecycle", getBatchLifecycle);

module.exports = router;
