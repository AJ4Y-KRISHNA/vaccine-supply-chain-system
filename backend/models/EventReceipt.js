const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  eventId: { type: String, required: true }, group: { type: String, required: true },
  correlationId: String, readingId: mongoose.Schema.Types.ObjectId, completedAt: { type: Date, default: Date.now },
});
schema.index({ eventId: 1, group: 1 }, { unique: true });
module.exports = mongoose.model("EventReceipt", schema);
