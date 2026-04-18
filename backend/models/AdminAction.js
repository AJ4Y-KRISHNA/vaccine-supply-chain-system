const mongoose = require("mongoose");

const AdminActionSchema = new mongoose.Schema({
  actionType: String,
  actorRole: {
    type: String,
    default: "Admin",
  },
  status: String,
  details: String,
  txHash: String,
  metadata: mongoose.Schema.Types.Mixed,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("AdminAction", AdminActionSchema);
