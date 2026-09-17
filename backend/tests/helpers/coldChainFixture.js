const mongoose = require("mongoose");
const { randomBytes } = require("crypto");
const Batch = require("../../models/Batch");
const Shipment = require("../../models/Shipment");
const Policy = require("../../models/ColdChainPolicy");
const User = require("../../models/user");
const dbName = `codex_cc_test_${randomBytes(8).toString("hex")}`;
let sequence = 0;
const examplePolicy = {
  minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 40, maximumHumidity: 80,
  excursionDurationMs: 120000, maximumReadingGapMs: 90000, criticalBatteryPercent: 10,
  maximumRateCelsiusPerMinute: 100, sourceReference: "TEST FIXTURE ONLY — not a medical policy", approvalReason: "Synthetic test approval",
};
async function connect() {
  // Never use MONGO_URI (the application's database). Only a unique test database is touched.
  await mongoose.connect(process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27017", { dbName, serverSelectionTimeoutMS: 3000 });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
}
async function close() {
  if (mongoose.connection.name === dbName && /^codex_cc_test_[a-f0-9]{16}$/.test(dbName)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
async function fixture({ approved = true, policy: overrides = {} } = {}) {
  const batchId = `TEST-${++sequence}`;
  const shipmentId = `SHIP-${sequence}`;
  const reviewer = await User.create({ email: `reviewer-${sequence}@example.test`, password: "test", role: "admin", canReviewColdChain: true });
  const batch = await Batch.create({ batchId, vaccineType: "Synthetic vaccine", manufacturer: "maker-a", quantity: 100, status: "Ready", temperaturePolicy: { minimumTemperature: 2, maximumTemperature: 8 } });
  await Shipment.create({ shipmentId, batchId, distributor: "dist-a", destination: "hospital-a", status: "In Transit" });
  let policy;
  if (approved) {
    policy = await Policy.create({ ...examplePolicy, ...overrides, batchId, vaccineType: batch.vaccineType, approvedBy: reviewer._id });
    batch.coldChainPolicyId = policy._id; await batch.save();
  }
  const at = minute => new Date(Date.UTC(2026, 0, 1) + minute * 60000).toISOString();
  const reading = (temperature, minute = 0, extra = {}) => ({ batchId, shipmentId, deviceId: `SENSOR-${sequence}`, vehicleId: "TRUCK-1", temperature, humidity: 60, batteryLevel: 90, latitude: 9, longitude: 76, timestamp: at(minute), ...extra });
  return { batch, batchId, shipmentId, reviewer, policy, reading, at };
}
module.exports = { connect, close, fixture, examplePolicy };
