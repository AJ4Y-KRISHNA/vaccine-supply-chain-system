const mongoose = require("mongoose");

const RawMaterialSchema = new mongoose.Schema({
  batchId: String,
  supplier: String,
  materialType: String,
  quantity: Number,
  unit: { type: String, default: "units" },
  status: { type: String, default: "Received" },
  txHash: String,
  receivedAt: { type: Date, default: Date.now },
  notes: String,
});

module.exports = mongoose.model("RawMaterial", RawMaterialSchema);
