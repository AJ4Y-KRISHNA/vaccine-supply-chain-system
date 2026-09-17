const mongoose = require("mongoose");

const TemperatureLogSchema = new mongoose.Schema({
  shipmentId: String,
  batchId: String,
  sensorId: String,
  // Optional fields keep the original temperature ingestion contract intact while
  // allowing software-simulated (and future real) IoT telemetry to be recorded.
  deviceId: String,
  vehicleId: String,
  temperature: Number,
  humidity: Number,
  batteryLevel: Number,
  evaluation: mongoose.Schema.Types.Mixed,
  recordedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["Normal", "Alert"], default: "Normal" },
  location: {
    lat: Number,
    lng: Number,
  },
  simulation: {
    source: String,
    scenario: String,
    seed: String,
    tick: Number,
  },
});

require("./demoFields")(TemperatureLogSchema);
module.exports = mongoose.model("TemperatureLog", TemperatureLogSchema);
