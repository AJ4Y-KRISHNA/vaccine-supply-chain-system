const mongoose = require("mongoose");
const TemperatureAlert = require("../models/TemperatureAlert");

async function main() {
  const [batchId, deviceId] = process.argv.slice(2);
  if (!batchId || !deviceId) throw new Error("Usage: node scripts/waitForAlert.js <synthetic-batch-id> <synthetic-device-id>");
  await mongoose.connect(process.env.MONGO_URI);
  const deadline = Date.now() + 60000;
  let alerts = [];
  while (Date.now() < deadline) {
    alerts = await TemperatureAlert.find({ batchId, deviceId }).select("alertId batchId deviceId severity phase timestamp").lean();
    if (alerts.length) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!alerts.length) throw new Error(`No policy alert was processed for ${batchId} within 60 seconds`);
  console.log(JSON.stringify({ result: "PASS", synthetic: true, batchId, deviceId, alertCount: alerts.length, alerts }));
  await mongoose.disconnect();
}

main().catch(async error => { console.error(error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });
