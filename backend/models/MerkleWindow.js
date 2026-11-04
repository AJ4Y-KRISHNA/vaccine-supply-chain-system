const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  windowId: { type: String, required: true, unique: true },
  batchId: { type: String, required: true, index: true },
  root: { type: String, required: true },
  windowStart: Date, windowEnd: Date,
  count: { type: Number, min: 1, max: 100 },
  readingIds: [mongoose.Schema.Types.ObjectId],
  status: { type: String, enum: ["pending", "confirmed", "failed"], default: "pending" },
  txHash: String, chainId: Number, contractAddress: String,
  gasUsed: String, gasPerReading: Number, attempts: { type: Number, default: 0 },
  nextAttemptAt: Date, lastError: String, confirmedAt: Date,
  correlationId: String, synthetic: { type: Boolean, default: true },
}, { timestamps: true });
module.exports = mongoose.model("MerkleWindow", schema);
