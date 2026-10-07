const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  planId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  approvedAt: { type: Date, default: Date.now }, reason: { type: String, required: true },
  correlationId: String, isDemo: { type: Boolean, default: true },
});
require("./appendOnly")(schema);
module.exports = mongoose.model("ForecastPlanApproval", schema);
