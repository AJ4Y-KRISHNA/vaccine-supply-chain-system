const mongoose = require("mongoose");
const User = require("./models/user");
const bcrypt = require("bcryptjs");

mongoose.connect("mongodb://127.0.0.1:27017/vaccineDB");

async function seed() {
  if (!process.argv.includes("--execute")) throw new Error("Use --execute to add missing local demo accounts; existing accounts are never deleted");
  const accounts = [
    { email: "admin@test.com", password: "123456", role: "admin" },
    { email: "manufacturer@test.com", password: "123456", role: "manufacturer" },
    { email: "distributor@test.com", password: "123456", role: "distributor" },
    { email: "hospital@test.com", password: "123456", role: "healthcare" }
  ];
  for (const account of accounts) {
    if (await User.exists({ email: account.email })) continue;
    account.password = await bcrypt.hash(process.env.DEMO_ACCOUNT_PASSWORD || account.password, 12);
    await User.create(account);
  }

  console.log("✅ Users created");
  process.exit();
}

seed().catch(error => { console.error(error.message); mongoose.disconnect(); process.exitCode = 1; });
