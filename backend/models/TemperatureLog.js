const mongoose = require("mongoose");

const TemperatureLogSchema = new mongoose.Schema({
  shipmentId: String,
  batchId: String,
  sensorId: String,
  // Optional fields keep the original temperature ingestion contract intact while
  // allowing software-simulated (and future real) IoT telemetry to be recorded.
  deviceId: String,
  vehicleId: String,
  sequenceNumber: { type: Number, min: 0 },
  idempotencyKey: { type: String, select: false },
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
TemperatureLogSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true, name: "temperature_log_idempotency_key_unique" }
);
module.exports = mongoose.model("TemperatureLog", TemperatureLogSchema);
