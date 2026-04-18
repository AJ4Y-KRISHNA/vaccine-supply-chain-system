const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const {
  submitFeedback,
  getHealthcareFeedback,
  getAdminFeedback,
} = require("../controllers/feedbackController");

router.post("/", authenticate, submitFeedback);
router.get("/healthcare", authenticate, getHealthcareFeedback);
router.get("/admin", authenticate, getAdminFeedback);

module.exports = router;
