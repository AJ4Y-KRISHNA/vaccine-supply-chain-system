const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { requireIdentity, protectOperation } = require("../middleware/coldChainAccess");
const { scopeData, bindOrganization } = require("../middleware/identityScope");
router.use(requireIdentity, require("../middleware/auth").allowRoles("manufacturer"), scopeData);
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
router.post("/raw-materials", authenticate, bindOrganization, protectOperation(["admin", "manufacturer"], receiveRawMaterials, { allowNewBatch: true }));

// 1.2 Produce Vaccine
router.post("/produce", authenticate, bindOrganization, protectOperation(["admin", "manufacturer"], produceVaccine, { allowNewBatch: true }));

// 1.3 Create Vaccine Batch (DB + blockchain)
router.post("/batch", requireIdentity, protectOperation(["admin", "manufacturer"], createBatch, { allowNewBatch: true }));

// 1.4 Create Batch Report
router.post("/batch/report", requireIdentity, protectOperation(["admin", "manufacturer"], createBatchReport));
router.post("/batch/:batchId/sign-release", requireIdentity, protectOperation(["admin", "manufacturer"], signBatchRelease));

// Full DFD workflow
router.post("/workflow", requireIdentity, protectOperation(["admin", "manufacturer"], runManufacturerWorkflow, { allowNewBatch: true }));

// Monitoring endpoint
router.get("/batches", authenticate, getBatchDetails);

module.exports = router;
