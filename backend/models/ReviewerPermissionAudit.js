const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  targetUserId: { type: String, required: true, index: true },
  targetEmail: { type: String, required: true },
  actorId: { type: String, required: true },
  action: { type: String, enum: ["GRANT_REQUESTED", "GRANT_APPLIED", "REVOKE_REQUESTED", "REVOKE_APPLIED"], required: true },
  previousPermission: { type: Boolean, required: true },
  requestedPermission: { type: Boolean, required: true },
  reason: { type: String, required: true },
  eventTime: { type: Date, required: true },
});
require("./appendOnly")(schema);
module.exports = mongoose.model("ReviewerPermissionAudit", schema);
