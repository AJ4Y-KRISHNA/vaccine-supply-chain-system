const mongoose = require("mongoose");

const TemperatureLogSchema = new mongoose.Schema({
  shipmentId: String,
  batchId: String,
  sensorId: String,
  temperature: Number,
  recordedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["Normal", "Alert"], default: "Normal" },
  location: {
    lat: Number,
    lng: Number,
  },
});

module.exports = mongoose.model("TemperatureLog", TemperatureLogSchema);
