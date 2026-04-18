const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  createHospitalOrder,
  getHospitalOrders,
  getAdminOrders,
  reviewOrder,
  getDistributorOrders,
} = require("../controllers/orderController");

const router = express.Router();

router.post("/hospital", authenticate, createHospitalOrder);
router.get("/hospital", authenticate, getHospitalOrders);
router.get("/admin", authenticate, getAdminOrders);
router.patch("/:orderId/review", authenticate, reviewOrder);
router.get("/distributor", getDistributorOrders);

module.exports = router;
