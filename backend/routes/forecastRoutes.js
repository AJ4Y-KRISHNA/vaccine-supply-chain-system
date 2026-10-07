const express = require("express");
const router = express.Router();

const { getForecast } = require("../controllers/forecastController");
router.use(require("../middleware/auth").authenticate, require("../middleware/auth").allowRoles("admin", "manufacturer", "healthcare"), require("../middleware/identityScope").scopeData);

router.post("/", getForecast);
router.get("/", require("../controllers/analyticsController").getRegional);
router.get("/:id/metrics", require("../controllers/analyticsController").getMetrics);

module.exports = router;
