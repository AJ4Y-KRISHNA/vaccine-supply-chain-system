const express = require("express");
const router = express.Router();

const {
  getDistributorDashboard,
  getManufacturerDashboard,
  getHealthcareDashboard,
  getAdminDashboard,
} = require("../controllers/dashboardController");

const { authenticate, allowRoles } = require("../middleware/auth");
const { scopeData } = require("../middleware/identityScope");
router.use(authenticate, scopeData);

router.get("/distributor", allowRoles("distributor"), getDistributorDashboard);
router.get("/manufacturer", allowRoles("manufacturer"), getManufacturerDashboard);
router.get("/healthcare", allowRoles("healthcare"), getHealthcareDashboard);
router.get("/admin", allowRoles(), getAdminDashboard);

module.exports = router;
