const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { allowRoles } = require("../middleware/auth");
const { bindOrganization } = require("../middleware/identityScope");
router.use(authenticate);
const {
  submitFeedback,
  getHealthcareFeedback,
  getAdminFeedback,
} = require("../controllers/feedbackController");

router.post("/", allowRoles("healthcare"), bindOrganization, submitFeedback);
router.get("/healthcare", allowRoles("healthcare"), getHealthcareFeedback);
router.get("/admin", allowRoles(), getAdminFeedback);

module.exports = router;
