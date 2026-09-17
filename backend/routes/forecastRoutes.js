const express = require("express");
const router = express.Router();

const { getForecast } = require("../controllers/forecastController");
router.use(require("../middleware/auth").authenticate, require("../middleware/auth").allowRoles("manufacturer", "healthcare"));

router.post("/", getForecast);

module.exports = router;
