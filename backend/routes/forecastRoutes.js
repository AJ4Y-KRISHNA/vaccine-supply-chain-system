const express = require("express");
const router = express.Router();

const { getForecast } = require("../controllers/forecastController");

router.post("/", getForecast);

module.exports = router;
