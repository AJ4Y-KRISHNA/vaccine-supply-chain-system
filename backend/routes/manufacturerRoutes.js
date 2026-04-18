const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const {
  receiveRawMaterials,
  produceVaccine,
  createBatch,
  createBatchReport,
  signBatchRelease,
  runManufacturerWorkflow,
  getBatchDetails,
} = require("../controllers/manufacturerController");

// Manufacturer DFD: 1.1 Receive Raw Materials
router.post("/raw-materials", authenticate, receiveRawMaterials);

// 1.2 Produce Vaccine
router.post("/produce", authenticate, produceVaccine);

// 1.3 Create Vaccine Batch (DB + blockchain)
router.post("/batch", authenticate, createBatch);

// 1.4 Create Batch Report
router.post("/batch/report", authenticate, createBatchReport);
router.post("/batch/:batchId/sign-release", authenticate, signBatchRelease);

// Full DFD workflow
router.post("/workflow", authenticate, runManufacturerWorkflow);

// Monitoring endpoint
router.get("/batches", authenticate, getBatchDetails);

module.exports = router;
