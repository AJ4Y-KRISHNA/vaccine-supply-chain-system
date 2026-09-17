const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  batchId: { type: String, required: true, index: true },
  alertId: String,
  action: { type: String, required: true },
  actorId: { type: String, required: true },
  reason: { type: String, required: true },
  eventTime: { type: Date, required: true },
  recordedAt: { type: Date, default: Date.now },
  snapshot: mongoose.Schema.Types.Mixed,
});
require("./appendOnly")(schema);
module.exports = mongoose.model("ColdChainAudit", schema);
