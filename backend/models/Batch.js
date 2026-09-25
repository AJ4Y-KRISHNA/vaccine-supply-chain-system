const mongoose = require("mongoose");

const BatchDispositionSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ["active", "administered", "expired", "discarded", "recalled"],
    default: "active",
    required: true,
  },
  reasonCode: { type: String, trim: true, maxlength: 80 },
  reason: { type: String, trim: true, maxlength: 500 },
  recordedAt: Date,
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  recordedByRole: { type: String, enum: ["admin", "manufacturer", "distributor", "healthcare"] },
}, { _id: false });

BatchDispositionSchema.pre("validate", function validateTerminalDisposition(next) {
  if (this.status !== "active") {
    if (!this.reasonCode) this.invalidate("reasonCode", "A reason code is required for a terminal batch disposition");
    if (!this.recordedAt || !Number.isFinite(+new Date(this.recordedAt))) this.invalidate("recordedAt", "A timestamp is required for a terminal batch disposition");
    if (!this.recordedBy) this.invalidate("recordedBy", "The actor is required for a terminal batch disposition");
  }
  next();
});

const BatchSchema = new mongoose.Schema({
  batchId: String,
  vaccineType: String,
  quantity: Number,
  manufacturer: String,
  expiresAt: Date,
  disposition: { type: BatchDispositionSchema, default: () => ({ status: "active" }) },
  coldChainPolicyId: { type: mongoose.Schema.Types.ObjectId, ref: "ColdChainPolicy" },
  coldChainHoldAlertIds: { type: [String], default: undefined },
  coldChainStatus: String,
  // Legacy draft limits are retained for compatibility, but evaluation requires
  // an explicitly approved, versioned coldChainPolicyId.
  temperaturePolicy: {
    minimumTemperature: Number,
    maximumTemperature: Number,
    warningDeviationCelsius: Number,
  },
  txHash: String,
  baselineDemandForecast: {
    type: Number,
    default: 0,
  },
  certificateMinted: {
    type: Boolean,
    default: false,
  },
  certificateId: String,
  certificateTxHash: String,
  certificateMintedAt: Date,
  certificateUri: String,
  releaseVisibleToExternal: {
    type: Boolean,
    default: false,
  },
  releaseStage: {
    type: String,
    default: "Awaiting Production Sign-Off",
  },
  releaseApprovedAt: Date,
  productionApproved: {
    type: Boolean,
    default: false,
  },
  productionApprovedAt: Date,
  productionSigner: String,
  labApproved: {
    type: Boolean,
    default: false,
  },
  labApprovedAt: Date,
  labSigner: String,
  status: {
    type: String,
    default: "Manufactured"
  },
  productionStatus: {
    type: String,
    default: "Pending"
  },
  reportStatus: {
    type: String,
    default: "Pending"
  },
  distributionRequested: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

require("./demoFields")(BatchSchema);
module.exports = mongoose.model("Batch", BatchSchema);
