const express = require("express");
const router = express.Router();
const { ingestLog, getLogs } = require("../controllers/temperatureController");
const rateLimit = require("express-rate-limit");

const apiKey = process.env.TEMP_API_KEY;
const requireApiKey = (req, res, next) => {
  if (!apiKey) return res.status(500).json({ error: "TEMP_API_KEY not set" });
  const supplied = req.headers["x-api-key"];
  if (supplied !== apiKey) return res.status(401).json({ error: "Invalid API key" });
  next();
};

const tempLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120, // 120 readings/min per key
});

router.post("/ingest", tempLimiter, requireApiKey, ingestLog);
router.get("/", tempLimiter, requireApiKey, getLogs);

module.exports = router;
