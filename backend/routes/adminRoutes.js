const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
router.use(authenticate, require("../middleware/auth").allowRoles());
const {
  getUserManagement,
  getChainMonitoring,
  runSentimentMonitoring,
  getReportsAndInsights,
  getAdminWorkflow,
} = require("../controllers/adminController");

router.get("/users", authenticate, getUserManagement);
router.get("/monitoring", authenticate, getChainMonitoring);
router.post("/sentiment", authenticate, runSentimentMonitoring);
router.get("/reports", authenticate, getReportsAndInsights);
router.get("/workflow", authenticate, getAdminWorkflow);

module.exports = router;
