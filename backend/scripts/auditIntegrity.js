// Read-only inventory of ambiguous records. No migration/deletion is performed.
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const mongoose = require("mongoose");
const { buildIntegrityReport } = require("../services/dataIntegrityService");

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("Configure MONGO_URI before auditing");
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000 });
  try {
    const [batches, shipments, logs, orders, users] = await Promise.all([
      require("../models/Batch").find().select("batchId manufacturer quantity vaccineType").lean(),
      require("../models/Shipment").find().select("shipmentId batchId orderId vaccineType quantity").lean(),
      require("../models/TemperatureLog").find().select("batchId shipmentId").lean(),
      require("../models/Order").find().select("orderId auditBatchId allocatedBatchId shipmentId status").lean(),
      require("../models/user").find().select("role manufacturer email -_id").lean(),
    ]);
    console.log(JSON.stringify(buildIntegrityReport({ batches, shipments, logs, orders, users }), null, 2));
  } finally { await mongoose.disconnect(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
