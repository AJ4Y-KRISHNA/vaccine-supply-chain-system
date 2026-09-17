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
const { requireIdentity, protectOperation } = require("../middleware/coldChainAccess");

// Admin routes for triggering distribution
router.post("/admin/distribute", requireIdentity, protectOperation(["admin"], createDistribution));

// Distributor DFD flow
router.post("/distributor/receive-batch", requireIdentity, protectOperation(["admin", "distributor"], receiveBatchInfo));
router.patch("/distributor/verify/:shipmentId", requireIdentity, protectOperation(["admin", "distributor"], verifyVaccineDetails));
router.patch("/distributor/status/:shipmentId", requireIdentity, protectOperation(["admin", "distributor"], updateDeliveryStatus));
router.patch("/distributor/supply/:shipmentId", requireIdentity, protectOperation(["admin", "distributor"], supplyVaccinationCenter));
router.patch("/healthcare/confirm/:shipmentId", requireIdentity, protectOperation(["admin", "healthcare"], confirmDeliveryReceipt));
router.get("/distributor/workflow", authenticate, getDistributorWorkflow);

router.get("/distributor/status", getAllDistributions);
router.get("/healthcare/status", getAllDistributions);
router.get("/", getAllDistributions);
module.exports = router;
