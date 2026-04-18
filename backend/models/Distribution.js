const mongoose = require("mongoose");

const DistributionSchema = new mongoose.Schema({
  batchId: String,
  demand: Number,
  supply: Number,
  decision: String,
  txHash: String,
  sentimentScore: Number,
  forecastDemand: Number,
  currentStock: Number,
  riskFlag: Boolean,
  targetCenter: String,
  blockchainStatus: {
    type: String,
    default: "Pending"
  },
  socialText: String,
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Distribution", DistributionSchema);
