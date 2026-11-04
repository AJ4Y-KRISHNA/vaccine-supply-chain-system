const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  auditId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  batchId: { type: String, required: true, index: true },
  eventId: { type: String, required: true }, digest: { type: String, required: true },
  status: { type: String, enum: ["pending", "confirmed", "failed"], default: "pending" },
  txHash: String, chainId: Number, contractAddress: String, lastError: String, confirmedAt: Date,
}, { timestamps: true });
module.exports = mongoose.model("AuditAnchor", schema);
