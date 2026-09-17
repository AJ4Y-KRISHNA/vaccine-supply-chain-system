const express = require("express");
const { authenticate } = require("../middleware/auth");
const { requireIdentity } = require("../middleware/coldChainAccess");
const {
  createHospitalOrder,
  getHospitalOrders,
  getAdminOrders,
  reviewOrder,
  getDistributorOrders,
} = require("../controllers/orderController");

const router = express.Router();
const requireAdmin = (req, res, next) => req.user.role === "admin"
  ? next() : res.status(403).json({ error: "Admin role required" });

router.post("/hospital", authenticate, createHospitalOrder);
router.get("/hospital", authenticate, getHospitalOrders);
router.get("/admin", requireIdentity, requireAdmin, getAdminOrders);
router.patch("/:orderId/review", requireIdentity, requireAdmin, reviewOrder);
router.get("/distributor", getDistributorOrders);

module.exports = router;
