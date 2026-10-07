const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now },
  vaccineType: { type: String, required: true }, region: { type: String, required: true },
  correlationId: String, isDemo: { type: Boolean, default: true },
  result: mongoose.Schema.Types.Mixed,
});
require("./appendOnly")(schema);
module.exports = mongoose.model("ForecastRun", schema);
