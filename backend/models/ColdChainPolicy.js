const mongoose = require("mongoose");
// Each approval creates a new revision. Existing revisions are never edited.
const schema = new mongoose.Schema({
  batchId: { type: String, required: true, index: true },
  vaccineType: String,
  minimumTemperature: { type: Number, required: true },
  maximumTemperature: { type: Number, required: true },
  minimumHumidity: Number,
  maximumHumidity: Number,
  excursionDurationMs: { type: Number, required: true },
  maximumReadingGapMs: { type: Number, required: true },
  criticalBatteryPercent: { type: Number, required: true },
  maximumRateCelsiusPerMinute: { type: Number, required: true },
  sourceReference: { type: String, required: true },
  approvalReason: { type: String, required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  approvedAt: { type: Date, default: Date.now },
  rules: {
    brief: { type: String, default: "REQUEST_READING" },
    sustained: { type: String, default: "QUARANTINE" },
    reliability: { type: String, default: "CHECK_DEVICE" },
  },
});
require("./demoFields")(schema);
require("./appendOnly")(schema);
module.exports = mongoose.model("ColdChainPolicy", schema);
