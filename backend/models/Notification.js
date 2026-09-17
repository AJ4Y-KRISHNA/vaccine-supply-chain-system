const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipientRole: {
      type: String,
      required: true,
      index: true,
    },
    recipientRef: String,
    recipientRefKey: String,
    alertId: {
      type: String,
      index: true,
    },
    deduplicationKey: {
      type: String,
      unique: true,
      sparse: true,
    },
    orderId: String,
    auditBatchId: String,
    title: String,
    message: String,
    type: {
      type: String,
      default: "info",
    },
    read: {
      type: Boolean,
      default: false,
    },
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
