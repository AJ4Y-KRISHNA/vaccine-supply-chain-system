const mongoose = require("mongoose");

const BatchSchema = new mongoose.Schema({
  batchId: String,
  vaccineType: String,
  quantity: Number,
  manufacturer: String,
  expiresAt: Date,
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
