const mongoose = require("mongoose");
module.exports = mongoose.model("SimulatorDevice", new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  pendingReading: mongoose.Schema.Types.Mixed,
  lastError: String,
  running: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  startedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  monitoring: {
    enabled: { type: Boolean, default: false },
    anchorWallAt: Date,
    anchorSimulationAt: Date,
    expectedSince: Date,
  },
}, { timestamps: true }));
