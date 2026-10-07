const mongoose = require("mongoose");

const EdgeGatewayStateSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  lastSequenceNumber: { type: Number, default: -1 },
  ewma: Number,
  temperature: Number,
  timestamp: Number,
  latitude: Number,
  longitude: Number,
  flatlineSince: Number,
  points: { type: [{ temperature: Number, timestamp: Number, _id: false }], default: [] },
  temperatures: { type: [Number], default: [] },
  lastFingerprint: String,
  lastSentAt: Number,
  linkLoss: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.models.EdgeGatewayState || mongoose.model("EdgeGatewayState", EdgeGatewayStateSchema);
