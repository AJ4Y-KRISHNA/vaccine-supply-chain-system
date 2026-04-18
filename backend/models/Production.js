const mongoose = require("mongoose");

const ProductionSchema = new mongoose.Schema({
  batchId: String,
  vaccineType: String,
  quantity: Number,
  manufacturer: String,
  materialsUsed: [{ materialType: String, quantity: Number, unit: String }],
  status: { type: String, default: "Produced" },
  txHash: String,
  producedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Production", ProductionSchema);
