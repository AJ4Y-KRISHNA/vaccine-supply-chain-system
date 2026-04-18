const mongoose = require("mongoose");

const BatchReportSchema = new mongoose.Schema({
  batchId: String,
  vaccineType: String,
  quantity: Number,
  yieldRate: Number,
  wastageRate: Number,
  txHash: String,
  status: { type: String, default: "Reported" },
  remarks: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("BatchReport", BatchReportSchema);
