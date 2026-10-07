const express = require("express");
const { authenticate } = require("../middleware/auth");
const { requireIdentity } = require("../middleware/coldChainAccess");
const {
  createHospitalOrder,
  getHospitalOrders,
  getAdminOrders,
  reviewOrder,
  getDistributorOrders,
  importOrders,
} = require("../controllers/orderController");

const router = express.Router();
const { allowRoles } = require("../middleware/auth");
const { scopeData, bindOrganization } = require("../middleware/identityScope");
router.use(requireIdentity, scopeData);
const requireAdmin = (req, res, next) => req.user.role === "admin"
  ? next() : res.status(403).json({ error: "Admin role required" });

router.post("/hospital", authenticate, allowRoles("healthcare"), bindOrganization, createHospitalOrder);
router.post("/", authenticate, allowRoles("healthcare"), createHospitalOrder);
router.post("/import", authenticate, allowRoles("healthcare"), express.raw({ type: ["text/csv", "application/csv"], limit: "8mb" }), importOrders);
router.get("/hospital", authenticate, allowRoles("healthcare"), getHospitalOrders);
router.get("/admin", requireIdentity, requireAdmin, getAdminOrders);
router.patch("/:orderId/review", requireIdentity, requireAdmin, reviewOrder);
router.get("/distributor", allowRoles("distributor"), getDistributorOrders);

module.exports = router;
