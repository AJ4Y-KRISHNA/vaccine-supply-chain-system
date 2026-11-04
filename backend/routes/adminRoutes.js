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
  getColdChainReviewers,
  setColdChainReviewer,
} = require("../controllers/adminController");
const { getSystemReadiness } = require("../services/systemReadiness");
const { listEmailDeliveries } = require("../controllers/emailDeliveryController");

router.get("/users", authenticate, getUserManagement);
router.get("/monitoring", authenticate, getChainMonitoring);
router.post("/sentiment", authenticate, runSentimentMonitoring);
router.get("/reports", authenticate, getReportsAndInsights);
router.get("/workflow", authenticate, getAdminWorkflow);
router.get("/readiness", getSystemReadiness);
router.get("/email-deliveries", listEmailDeliveries);
router.post("/forecast-plan", require("../controllers/analyticsController").createPlan);
router.post("/forecast-plan/:id/approve", require("../controllers/analyticsController").approvePlan);
router.get("/cold-chain/reviewers", getColdChainReviewers);
router.patch("/cold-chain/reviewers/:userId", setColdChainReviewer);
router.get("/supply-plan/inputs", async (req, res) => {
  try { res.json({ orders: await require("../models/Order").find({ status: "Pending" }).lean(), inventory: await require("../services/inventoryEligibility").inventorySnapshot() }); }
  catch (_) { res.status(503).json({ error: "Planning inputs unavailable" }); }
});
router.post("/supply-plan", async (req, res) => {
  try {
    const inputs = { destinations: req.body.destinations, transportCapacityDoses: req.body.transportCapacityDoses, asOf: req.body.asOf };
    const result = require("../services/supplyPlanner").planSupply({ ...inputs,
      orders: await require("../models/Order").find({ status: "Pending" }).lean(), inventory: await require("../services/inventoryEligibility").inventorySnapshot() });
    const plan = await require("../models/SupplyPlan").create({ createdBy: req.user.id, inputs, result });
    res.status(201).json({ planId: plan._id, ...result });
  } catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

module.exports = router;
