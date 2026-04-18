const express = require("express");
const router = express.Router();

const {
  createDistribution,
  getAllDistributions,
  receiveBatchInfo,
  verifyVaccineDetails,
  updateDeliveryStatus,
  supplyVaccinationCenter,
  confirmDeliveryReceipt,
  getDistributorWorkflow,
} = require("../controllers/distributionController");
const { authenticate } = require("../middleware/auth");

// Admin routes for triggering distribution
router.post("/admin/distribute", authenticate, createDistribution);

// Distributor DFD flow
router.post("/distributor/receive-batch", authenticate, receiveBatchInfo);
router.patch("/distributor/verify/:shipmentId", authenticate, verifyVaccineDetails);
router.patch("/distributor/status/:shipmentId", authenticate, updateDeliveryStatus);
router.patch("/distributor/supply/:shipmentId", authenticate, supplyVaccinationCenter);
router.patch("/healthcare/confirm/:shipmentId", authenticate, confirmDeliveryReceipt);
router.get("/distributor/workflow", authenticate, getDistributorWorkflow);

router.get("/distributor/status", getAllDistributions);
router.get("/healthcare/status", getAllDistributions);
router.get("/", getAllDistributions);
module.exports = router;
