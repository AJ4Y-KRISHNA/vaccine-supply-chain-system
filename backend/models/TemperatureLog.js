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
  correlationId: { type: String, maxlength: 128, index: true },
  eventId: { type: String, index: true },
  idempotencyKey: { type: String, select: false },
  // Optional simulator provenance; legacy ingestion records remain valid.
  source: { type: String, enum: ["simulator", "manual", "csv", "auto-simulated", "manual-override"], default: "simulator", index: true },
  enteredBy: String,
  note: { type: String, maxlength: 1000 },
  needsReview: { type: Boolean, default: false },
  supersedes: { type: mongoose.Schema.Types.ObjectId, ref: "TemperatureLog" },
  overrideId: String,
  operatorUserId: String,
  temperature: Number,
  humidity: Number,
  batteryLevel: Number,
  evaluation: mongoose.Schema.Types.Mixed,
  // Locally calculated synthetic edge metrics are preserved for dashboard/API inspection.
  edge: mongoose.Schema.Types.Mixed,
  recordedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["Normal", "Alert"], default: "Normal" },
  location: {
    lat: Number,
    lng: Number,
  },
  simulation: {
    source: String,
    telemetrySource: { type: String, enum: ["auto-simulated", "manual-override"] },
    overrideId: String,
    operatorUserId: String,
    scenario: String,
    seed: String,
    tick: Number,
    sourceSequenceNumber: Number,
    linkLoss: Boolean,
  },
});

require("./demoFields")(TemperatureLogSchema);
TemperatureLogSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true, name: "temperature_log_idempotency_key_unique" }
);
module.exports = mongoose.model("TemperatureLog", TemperatureLogSchema);
