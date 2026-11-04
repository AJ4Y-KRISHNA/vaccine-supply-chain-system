const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true },
  overrideId: { type: String, required: true, index: true },
  shipmentId: { type: String, required: true, index: true },
  batchId: { type: String, required: true, index: true },
  action: { type: String, enum: ["STARTED", "CHANGED", "RELEASED", "EXPIRED"], required: true },
  actorId: { type: String, required: true },
  eventTime: { type: Date, required: true },
  recordedAt: { type: Date, default: Date.now },
  reason: { type: String, required: true, maxlength: 500 },
  values: { type: mongoose.Schema.Types.Mixed, required: true },
});
require("./appendOnly")(schema);
module.exports = mongoose.model("SimulatorOverrideAudit", schema);
