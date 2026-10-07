// Compatibility migration: add ownership only to the exact existing seed fixtures.
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env"), quiet: true });
const mongoose = require("mongoose");
const Order = require("../models/Order");
const { demoBatches } = require("./seed");
async function backfill() {
  let count = 0;
  for (const batch of demoBatches) {
    const result = await Order.updateMany({ isDemo: true, "demoProvenance.source": "phase-1-seed",
      orderId: /^SYNTHETIC-HISTORY-\d{6}-\d{2}$/, vaccineType: batch.vaccineType,
      region: "Synthetic Demo Region", hospital: "Synthetic Demo Hospital",
      $or: [{ manufacturer: { $exists: false } }, { manufacturer: "" }, { manufacturer: null }] },
    { $set: { manufacturer: batch.manufacturer } }, { timestamps: false });
    count += result.modifiedCount;
  }
  return count;
}
if (require.main === module) mongoose.connect(process.env.MONGO_URI).then(backfill)
  .then(count => console.log(`Added explicit historical ownership to ${count} synthetic seed orders; no stock/password/allocation changes.`))
  .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
module.exports = backfill;
