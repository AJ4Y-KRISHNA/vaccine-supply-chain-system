require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env"), quiet: true });
const mongoose = require("mongoose");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI must point to the local synthetic demo database");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const migrations = [
    ["temperaturelogs", { source: { $in: ["auto-simulated", "software-iot-simulator"] } }, { $set: { source: "simulator" } }],
    ["temperaturelogs", { source: "manual-override" }, { $set: { source: "manual" } }],
    ["temperaturelogs", { source: { $exists: false } }, { $set: { source: "simulator" } }],
    ["temperaturelogs", { source: { $nin: ["simulator", "manual", "csv"] } }, { $set: { source: "simulator" } }],
    ["locationhistories", { source: { $in: ["auto-simulated", "software-iot-simulator"] } }, { $set: { source: "simulator" } }],
    ["locationhistories", { source: "manual-override" }, { $set: { source: "manual" } }],
    ["locationhistories", { source: { $exists: false } }, { $set: { source: "simulator" } }],
    ["locationhistories", { source: { $nin: ["simulator", "manual", "csv"] } }, { $set: { source: "simulator" } }],
    ["orders", { source: { $exists: false } }, { $set: { source: "simulator" } }],
    ["orders", { source: { $nin: ["simulator", "manual", "csv"] } }, { $set: { source: "simulator" } }],
    ["vaccinations", { source: { $exists: false } }, { $set: { source: "simulator" } }],
    ["vaccinations", { source: { $nin: ["simulator", "manual", "csv"] } }, { $set: { source: "simulator" } }],
  ];
  for (const [collection, filter, update] of migrations) {
    const result = await db.collection(collection).updateMany(filter, update);
    console.log(`${collection}: modified ${result.modifiedCount}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
