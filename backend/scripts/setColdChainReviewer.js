// Explicit local operator action only. This is never called by server startup or login.
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/user");
const Audit = require("../models/ColdChainAudit");
async function main() {
  const [email, mode, actor, reason] = process.argv.slice(2);
  if (!email || !["grant", "revoke"].includes(mode) || !actor || !reason || reason.trim().length < 3) {
    throw new Error('Usage: node scripts/setColdChainReviewer.js <email> grant|revoke <operator-name> "reason"');
  }
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  const users = await User.find({ email, role: { $in: ["admin", "manufacturer"] } });
  if (users.length !== 1) throw new Error("Expected exactly one existing admin/manufacturer account with this email; no account was changed");
  const user = users[0];
  await Audit.create({ batchId: "__access_control__", action: mode === "grant" ? "REVIEWER_GRANT_AUTHORIZED" : "REVIEWER_REVOKE_AUTHORIZED", actorId: `local-operator:${actor}`, reason,
    eventTime: new Date(), snapshot: { userId: user._id, email, previous: user.canReviewColdChain, next: mode === "grant" } });
  user.canReviewColdChain = mode === "grant";
  await user.save();
  console.log(`Cold-chain review capability ${mode === "grant" ? "granted to" : "revoked from"} ${email}. Role and ownership were not changed.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
