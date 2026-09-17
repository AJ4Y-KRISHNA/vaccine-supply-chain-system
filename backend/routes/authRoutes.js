const express = require("express");
const router = express.Router();
const { login, refresh } = require("../controllers/authController");
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Too many authentication attempts; try again later" } }));

router.post("/login", login);
router.post("/refresh", refresh);

module.exports = router;
