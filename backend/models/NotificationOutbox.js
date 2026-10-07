const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  deduplicationKey: { type: String, unique: true, required: true },
  alertId: String, correlationId: String, stage: String, snapshot: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ["queued", "sending", "sent", "dead-letter"], default: "queued" },
  attempts: { type: Number, default: 0 }, nextAttemptAt: { type: Date, default: Date.now },
  lockedAt: Date, lastError: String,
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1 });
module.exports = mongoose.model("NotificationOutbox", schema);
