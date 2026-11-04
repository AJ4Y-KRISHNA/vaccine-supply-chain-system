const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    auditBatchId: {
      type: String,
      required: true,
      index: true,
    },
    hospital: String,
    // auditBatchId remains a historical order reference, never a physical batch ID.
    allocatedBatchId: String,
    shipmentId: String,
    distributor: String,
    // Historical demand owner, not an assertion of physical batch allocation.
    manufacturer: String,
    centerId: String,
    region: String,
    vaccineType: String,
    requestedDoses: Number,
    priority: {
      type: String,
      default: "Normal",
    },
    notes: String,
    source: { type: String, enum: ["simulator", "manual", "csv"], default: "simulator" },
    enteredBy: String,
    note: String,
    status: {
      type: String,
      default: "Pending",
      index: true,
    },
    sentimentScore: {
      type: Number,
      default: 0.5,
    },
    sentimentLabel: {
      type: String,
      default: "Neutral",
    },
    riskFlag: {
      type: String,
      default: "Medium",
    },
    forecastDemand: {
      type: Number,
      default: 0,
    },
    availableStock: {
      type: Number,
      default: 0,
    },
    adminDecisionNote: String,
    blockchainStatus: {
      type: String,
      default: "Pending",
    },
    approvalTxHash: String,
    reviewedAt: Date,
    reviewedBy: String,
    distributorVisible: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

require("./demoFields")(orderSchema);
module.exports = mongoose.model("Order", orderSchema);
