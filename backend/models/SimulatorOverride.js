const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  overrideId: { type: String, required: true, unique: true },
  shipmentId: { type: String, required: true, index: true },
  batchId: { type: String, required: true, index: true },
  mode: { type: String, enum: ["auto", "manual"], default: "manual", required: true },
  status: { type: String, enum: ["ACTIVE", "RELEASED", "EXPIRED"], default: "ACTIVE", required: true },
  presetId: String,
  effect: { type: String, enum: ["READING", "SENSOR_FAULT"], default: "READING" },
  targetTemperature: { type: Number, min: -40, max: 60 },
  targetHumidity: { type: Number, min: 0, max: 100 },
  behavior: { type: String, enum: ["hold", "ramp"], required: true },
  rampDuration: { type: Number, min: 0, required: true },
  holdDuration: { type: Number, min: 0, required: true },
  expiresAt: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, required: true },
  effectiveAt: { type: Date, required: true },
  updatedBy: String,
  releasedAt: Date,
  reason: { type: String, required: true, maxlength: 500 },
  deviceStarts: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },
}, { timestamps: true });

// A shipment can have history, but only one current manual override.
schema.index({ shipmentId: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" }, name: "one_active_simulator_override_per_shipment" });
schema.index({ shipmentId: 1, createdAt: -1 });

module.exports = mongoose.model("SimulatorOverride", schema);
