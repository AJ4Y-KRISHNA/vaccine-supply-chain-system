const mongoose = require("mongoose");
module.exports = mongoose.model("TelemetryState", new mongoose.Schema({
  streamKey: { type: String, unique: true, required: true },
  batchId: { type: String, required: true, index: true },
  shipmentId: String,
  deviceId: String,
  vehicleId: String,
  policyId: mongoose.Schema.Types.ObjectId,
  lastReadingAt: Date,
  checkedAt: Date,
  temperature: Number,
  humidity: Number,
  batteryLevel: Number,
  latitude: Number,
  longitude: Number,
  temperatureSince: Date,
  temperatureDirection: String,
  source: String,
}));
