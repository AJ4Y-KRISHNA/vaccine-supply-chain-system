const mongoose = require("mongoose");

const LocationHistorySchema = new mongoose.Schema({
  batchId: { type: String, required: true, trim: true },
  shipmentId: { type: String, default: "" },
  deviceId: { type: String, default: "" },
  vehicleId: { type: String, default: "" },
  correlationId: { type: String, maxlength: 128, index: true },
  sequenceNumber: { type: Number, min: 0 },
  temperatureLogId: { type: String, required: true, unique: true },
  // The event-backbone initializer manages this time index/TTL explicitly so
  // Mongoose autoIndex cannot conflict with an existing converted TTL index.
  recordedAt: { type: Date, required: true },
  location: {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  source: { type: String, enum: ["simulator", "manual", "csv", "auto-simulated", "manual-override"], default: "simulator" },
  enteredBy: String,
  note: { type: String, maxlength: 1000 },
}, { timestamps: true });

LocationHistorySchema.index({ batchId: 1, recordedAt: 1, sequenceNumber: 1 });
require("./demoFields")(LocationHistorySchema);

module.exports = mongoose.model("LocationHistory", LocationHistorySchema);
