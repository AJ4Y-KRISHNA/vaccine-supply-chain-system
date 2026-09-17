require("dotenv").config();

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
app.use(cors());
app.use(express.json());

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
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

module.exports = app;
