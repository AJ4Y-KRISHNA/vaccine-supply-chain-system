const mongoose = require("mongoose");

const emailDeliverySchema = new mongoose.Schema({
  deduplicationKey: { type: String, required: true, unique: true },
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: "Notification", required: true, index: true },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
  recipientRole: { type: String, enum: ["admin", "manufacturer", "distributor", "healthcare"], required: true, index: true },
  recipientEmail: { type: String, required: true },
  alertId: { type: String, index: true },
  correlationId: { type: String, maxlength: 128, index: true },
  batchId: { type: String, index: true },
  subject: { type: String, required: true },
  text: { type: String, required: true },
  status: { type: String, enum: ["queued", "sending", "sent", "failed"], default: "queued", index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  transportMode: { type: String, enum: ["console", "sendgrid", "ethereal"] },
  simulated: { type: Boolean, default: false },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedAt: Date,
  sentAt: Date,
  lastError: String,
  providerMessageId: String,
  providerPreviewUrl: String,
  deadLetterPending: { type: Boolean, default: false },
  deadLetterAt: Date,
}, { timestamps: true });

emailDeliverySchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
module.exports = mongoose.model("EmailDelivery", emailDeliverySchema);
