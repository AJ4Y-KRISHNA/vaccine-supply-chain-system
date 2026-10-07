const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  readingId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  batchId: { type: String, required: true, index: true },
  bucketStart: { type: Date, required: true },
  bucketEnd: { type: Date, required: true },
  leafHash: { type: String, required: true },
  correlationId: String,
  windowId: { type: String, index: true },
  index: Number,
  proof: [{ _id: false, side: { type: String, enum: ["left", "right"] }, hash: String }],
  synthetic: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ batchId: 1, bucketStart: 1, windowId: 1 });
module.exports = mongoose.model("MerkleLeaf", schema);
