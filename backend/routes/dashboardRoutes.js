const express = require("express");
const router = express.Router();

const {
  getDistributorDashboard,
  getManufacturerDashboard,
  getHealthcareDashboard,
  getAdminDashboard,
} = require("../controllers/dashboardController");

// ✅ NO AUTH HERE

router.get("/distributor", getDistributorDashboard);
router.get("/manufacturer", getManufacturerDashboard);
router.get("/healthcare", getHealthcareDashboard);
router.get("/admin", getAdminDashboard);

module.exports = router;