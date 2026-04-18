const mongoose = require("mongoose");
const User = require("./models/user");

mongoose.connect("mongodb://127.0.0.1:27017/vaccineDB");

async function seed() {
  await User.deleteMany({});

  await User.insertMany([
    { email: "admin@test.com", password: "123456", role: "admin" },
    { email: "manufacturer@test.com", password: "123456", role: "manufacturer" },
    { email: "distributor@test.com", password: "123456", role: "distributor" },
    { email: "hospital@test.com", password: "123456", role: "healthcare" }
  ]);

  console.log("✅ Users created");
  process.exit();
}

seed();