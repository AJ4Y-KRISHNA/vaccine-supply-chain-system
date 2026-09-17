const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  operationId: { type: String, unique: true, required: true },
  targetCollection: { type: String, required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  before: mongoose.Schema.Types.Mixed,
  after: { type: mongoose.Schema.Types.Mixed, required: true },
  reason: { type: String, required: true },
  recordedAt: { type: Date, default: Date.now },
});
require("./appendOnly")(schema);
module.exports = mongoose.model("DemoReconciliation", schema);
