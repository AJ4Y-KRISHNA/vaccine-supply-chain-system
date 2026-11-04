const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const AdminAction = require("../models/AdminAction");
async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(uri).hostname)) throw new Error("Account migration is local-only");
  await mongoose.connect(uri);
  try {
    const accounts = await User.find().select("+password");
    let migrated = 0;
    for (const user of accounts) {
      if (/^\$2[aby]\$/.test(user.password || "")) continue;
      if (!user.password) throw new Error("Account without password requires explicit reset");
      if (!process.argv.includes("--execute")) { migrated++; continue; }
      const hash = await bcrypt.hash(user.password, 12);
      if (!await bcrypt.compare(user.password, hash)) throw new Error("Hash verification failed");
      const result = await User.updateOne({ _id: user._id, password: user.password }, { $set: { password: hash }, $inc: { tokenVersion: 1 } });
      if (result.modifiedCount !== 1) throw new Error("Account changed concurrently; no overwrite performed");
      await AdminAction.create({ actionType: "DEMO_PASSWORD_HASH_MIGRATION", status: "Completed",
        details: "Existing demo password hashed with bcrypt; sessions revoked. No plaintext or hash recorded in audit.", metadata: { userId: String(user._id) } });
      migrated++;
    }
    console.log(JSON.stringify({ mode: process.argv.includes("--execute") ? "apply" : "dry-run", accounts: accounts.length, migrated }));
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
