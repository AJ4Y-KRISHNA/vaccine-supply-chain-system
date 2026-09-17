require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });
require("./config/security").validateSecurity();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

// IMPORT ROUTES
const distributionRoutes = require("./routes/distributionRoutes");
const forecastRoutes = require("./routes/forecastRoutes");
const sentimentRoutes = require("./routes/sentimentRoutes");
const decisionRoutes = require("./routes/decisionRoutes");
const batchRoutes = require("./routes/batchRoutes");
const shipmentRoutes = require("./routes/shipmentRoutes");
const vaccinationRoutes = require("./routes/vaccinationRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const temperatureRoutes = require("./routes/temperatureRoutes");
const authRoutes = require("./routes/authRoutes");
const manufacturerRoutes = require("./routes/manufacturerRoutes");
const adminRoutes = require("./routes/adminRoutes");
const orderRoutes = require("./routes/orderRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const simulatorRoutes = require("./routes/simulatorRoutes");
const alertRoutes = require("./routes/alertRoutes");

const app = express();

// MIDDLEWARE
app.disable("x-powered-by");
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000").split(",");
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", "no-store");
  const unsafe = value => value && typeof value === "object" && Object.entries(value).some(([key, child]) => key.startsWith("$") || key.includes(".") || ["__proto__", "constructor", "prototype"].includes(key) || unsafe(child));
  if (unsafe(req.body) || unsafe(req.query)) return res.status(400).json({ error: "Invalid request field" });
  next();
});

// DATABASE CONNECTION
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected Successfully");
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
  });

// ROUTES
app.use("/api/auth", authRoutes);
app.use("/api/distribution", distributionRoutes);
app.use("/api/forecast", forecastRoutes);
app.use("/api/sentiment", sentimentRoutes);
app.use("/api/decision", decisionRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/shipments", shipmentRoutes);
app.use("/api/vaccinations", vaccinationRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/temperature", temperatureRoutes);
app.use("/api/simulator", simulatorRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/manufacturer", manufacturerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/feedback", feedbackRoutes);

// TEST ROUTE (IMPORTANT FOR DEBUG)
app.get("/", (req, res) => {
  res.send("🚀 Vaccine Supply Chain Backend Running...");
});

// SERVER START
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "test") {
  mongoose.connection.asPromise().then(() => app.listen(PORT, process.env.HOST || "127.0.0.1", () => {
    console.log(`🚀 Server running on port ${PORT}`);
  })).catch(() => { process.exitCode = 1; });
}

module.exports = app;
