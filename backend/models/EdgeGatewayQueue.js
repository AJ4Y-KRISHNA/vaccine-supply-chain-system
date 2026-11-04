const mongoose = require("mongoose");

const EdgeGatewayQueueSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  sequenceNumber: { type: Number, required: true, min: 0 },
  sourceSequenceNumber: Number,
  correlationId: String,
  telemetry: { type: mongoose.Schema.Types.Mixed, required: true },
  backendRecord: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ["pending", "forwarded"], default: "pending", index: true },
  queuedAt: { type: Date, default: Date.now },
  forwardedAt: Date,
}, { timestamps: true });

EdgeGatewayQueueSchema.index({ deviceId: 1, sequenceNumber: 1 }, { unique: true });
module.exports = mongoose.models.EdgeGatewayQueue || mongoose.model("EdgeGatewayQueue", EdgeGatewayQueueSchema);
