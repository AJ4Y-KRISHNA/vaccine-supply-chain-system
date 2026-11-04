const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const mongoose = require("mongoose");
const { planReconciliation, applyReconciliation } = require("../services/demoReconciliationService");
async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(uri).hostname)) throw new Error("Demo reconciliation is local-only");
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  try {
    const data = {};
    for (const [key, collection] of Object.entries({ batches: "batches", shipments: "shipments", logs: "temperaturelogs", orders: "orders", vaccinations: "vaccinations", users: "users" })) {
      data[key] = await mongoose.connection.collection(collection).find({}, key === "users" ? { projection: { password: 0 } } : {}).toArray();
    }
    const operations = planReconciliation(data);
    console.log(JSON.stringify({ mode: process.argv.includes("--execute") ? "apply" : "dry-run", operations: operations.length,
      byCollection: operations.reduce((counts, op) => ({ ...counts, [op.targetCollection]: (counts[op.targetCollection] || 0) + 1 }), {}) }));
    if (process.argv.includes("--execute")) {
      if (!process.argv.includes("--confirmed-demo")) throw new Error("Requires --confirmed-demo after project-owner confirmation");
      const Journal = require("../models/DemoReconciliation");
      await Journal.createCollection(); await Journal.createIndexes();
      await applyReconciliation(mongoose.connection, operations, Journal);
      console.log("Demo reconciliation complete; original field values retained in demoreconciliations. No records deleted or quality holds cleared.");
    }
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { main };
