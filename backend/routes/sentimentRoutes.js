const express = require("express");
const router = express.Router();
const { analyzeSentiment } = require("../controllers/sentimentController");
router.use(require("../middleware/auth").authenticate, require("../middleware/auth").allowRoles("manufacturer", "healthcare"));

router.post("/", analyzeSentiment);

module.exports = router;
