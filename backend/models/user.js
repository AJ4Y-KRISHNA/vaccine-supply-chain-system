const mongoose = require("mongoose");
const demoFields = require("./demoFields");

const userSchema = new mongoose.Schema({
  email: String,
  password: { type: String, select: false },
  disabled: { type: Boolean, default: false },
  tokenVersion: { type: Number, default: 0 },
  role: String, // admin, manufacturer, distributor, healthcare, field_operator
  // Manufacturer users should use the same value that their Batch.manufacturer
  // records use. It provides an explicit, backend-enforced ownership mapping.
  manufacturer: String,
  distributor: String,
  hospital: String,
  organizationAliases: { type: [String], default: undefined },
  canReviewColdChain: { type: Boolean, default: false },
});

demoFields(userSchema);

module.exports = mongoose.model("User", userSchema);
