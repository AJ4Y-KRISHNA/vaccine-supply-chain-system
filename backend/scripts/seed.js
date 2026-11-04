const path = require("node:path");
const dotenv = require("dotenv");
const backendRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(backendRoot, "../.env"), quiet: true });
// The repo-root `npm run seed` targets the Compose-published DB and must not
// silently inherit a different legacy backend/.env database name. Preserve
// `cd backend && npm run seed` as the compatibility route for backend/.env.
if (process.cwd() === backendRoot) dotenv.config({ path: path.join(backendRoot, ".env"), quiet: true });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const Batch = require("../models/Batch");
const ColdChainPolicy = require("../models/ColdChainPolicy");
const Order = require("../models/Order");
const Vaccination = require("../models/Vaccination");

const SYNTHETIC = Object.freeze({ source: "phase-1-seed", nature: "synthetic", clinicalUse: false });
const demoUsers = [
  { email: "admin@demo.synthetic.test", role: "admin", canReviewColdChain: true },
  { email: "manufacturer@demo.synthetic.test", role: "manufacturer", manufacturer: "Synthetic Demo Manufacturer" },
  { email: "distributor@demo.synthetic.test", role: "distributor", distributor: "Synthetic Demo Distributor" },
  { email: "fieldoperator@demo.synthetic.test", role: "field_operator", distributor: "Synthetic Demo Distributor" },
  { email: "healthcare@demo.synthetic.test", role: "healthcare", hospital: "Synthetic Demo Hospital" },
];
const demoBatches = [
  { batchId: "SYNTHETIC-DEMO-BATCH-A", vaccineType: "Synthetic Vaccine A", quantity: 800, manufacturer: "Synthetic Demo Manufacturer" },
  { batchId: "SYNTHETIC-DEMO-BATCH-B", vaccineType: "Synthetic Vaccine B", quantity: 520, manufacturer: "Synthetic Demo Manufacturer" },
  { batchId: "SYNTHETIC-DEMO-BATCH-C", vaccineType: "Synthetic Vaccine C", quantity: 360, manufacturer: "Synthetic Demo Manufacturer" },
];

function monthDate(now, offset) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1, 12));
}

function buildSyntheticOrderHistory({ now = new Date(), batches = demoBatches } = {}) {
  const rows = [];
  for (let offset = 35; offset >= 0; offset--) {
    const month = monthDate(now, offset);
    const monthOfYear = month.getUTCMonth();
    // Deterministic demand curve: seasonal winter/spring lift plus two campaign
    // periods each year. These are synthetic teaching values, not real demand.
    const seasonalMultiplier = 0.8 + 0.35 * (1 + Math.sin(((monthOfYear - 1) / 12) * Math.PI * 2)) / 2;
    const campaignSpike = [2, 8].includes(monthOfYear) ? 1.75 : 1;
    for (const [batchIndex, batch] of batches.entries()) {
      const baseDoses = [130, 95, 70][batchIndex] || 60;
      const requestedDoses = Math.max(10, Math.round(baseDoses * seasonalMultiplier * campaignSpike));
      const monthKey = `${month.getUTCFullYear()}${String(monthOfYear + 1).padStart(2, "0")}`;
      const orderId = `SYNTHETIC-HISTORY-${monthKey}-${String(batchIndex + 1).padStart(2, "0")}`;
      rows.push({
        orderId,
        auditBatchId: `SYNTHETIC-HISTORY-REFERENCE-${monthKey}-${batchIndex + 1}`,
        hospital: "Synthetic Demo Hospital",
        centerId: "SYNTHETIC-DEMO-HEALTH-001",
        region: "Synthetic Demo Region",
        distributor: "Synthetic Demo Distributor",
        manufacturer: batch.manufacturer,
        vaccineType: batch.vaccineType,
        requestedDoses,
        status: "Delivered",
        priority: campaignSpike > 1 ? "High" : "Normal",
        notes: `Synthetic 36-month demo history; seasonal=${seasonalMultiplier.toFixed(2)}, campaign=${campaignSpike.toFixed(2)}. Not real demand.`,
        isDemo: true,
        demoProvenance: { ...SYNTHETIC, reason: "Deterministic seasonal/campaign demonstration fixture" },
        createdAt: month,
        updatedAt: month,
      });
    }
  }
  return rows;
}

async function seed() {
  const hostMongoPort = Number(process.env.MONGO_HOST_PORT || 27017);
  if (!Number.isInteger(hostMongoPort) || hostMongoPort < 1 || hostMongoPort > 65535) {
    throw new Error("MONGO_HOST_PORT must be a valid local TCP port");
  }
  const mongoUri = process.env.MONGO_URI || `mongodb://127.0.0.1:${hostMongoPort}/vaccine_supply_chain`;
  const password = process.env.DEMO_SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set DEMO_SEED_PASSWORD to a local demo password of at least 12 characters");
  await mongoose.connect(mongoUri);
  try {
    await Promise.all([User.init(), Batch.init(), ColdChainPolicy.init(), Order.init(), Vaccination.init()]);
    const passwordHash = await bcrypt.hash(password, 12);
    const users = new Map();
    for (const user of demoUsers) {
      const saved = await User.findOneAndUpdate({ email: user.email }, { $set: {
        ...user, password: passwordHash, disabled: false, isDemo: true,
        demoProvenance: { ...SYNTHETIC, reason: "Seeded local demonstration account" },
      } }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
      users.set(user.role, saved);
    }

    for (const batch of demoBatches) {
      const admin = users.get("admin");
      let policy = await ColdChainPolicy.findOne({ batchId: batch.batchId, isDemo: true }).sort({ approvedAt: -1 });
      if (!policy) {
        policy = await ColdChainPolicy.create({
          batchId: batch.batchId, vaccineType: batch.vaccineType,
          minimumTemperature: 2, maximumTemperature: 8,
          minimumHumidity: 0, maximumHumidity: 100,
          excursionDurationMs: 120000, maximumReadingGapMs: 90000,
          criticalBatteryPercent: 10, maximumRateCelsiusPerMinute: 100,
          sourceReference: "SYNTHETIC DEMO POLICY ONLY — not a medical or WHO policy",
          approvalReason: "Synthetic teaching fixture approved for local software demonstration only",
          approvedBy: admin._id, approvedAt: new Date(), isDemo: true,
          demoProvenance: { ...SYNTHETIC, reason: "Synthetic approved 2–8 C demonstration rule" },
        });
      }
      await Batch.findOneAndUpdate({ batchId: batch.batchId }, { $set: {
        ...batch, status: "Ready", productionStatus: "Approved", coldChainPolicyId: policy._id,
        coldChainStatus: "NORMAL", temperaturePolicy: { minimumTemperature: 2, maximumTemperature: 8,
          warningDeviationCelsius: 0 }, expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        isDemo: true, demoProvenance: { ...SYNTHETIC, reason: "Synthetic seeded batch and stock quantity" },
      } }, { upsert: true, runValidators: true, setDefaultsOnInsert: true });

      await Vaccination.collection.updateOne({ hospital: "Synthetic Demo Hospital", operationId: `SYNTHETIC-STOCK-${batch.batchId}` }, {
        $set: { hospital: "Synthetic Demo Hospital", centerId: "SYNTHETIC-DEMO-HEALTH-001", batchId: batch.batchId,
          vaccineType: batch.vaccineType, receivedDoses: batch.quantity, stockBefore: 0, stockAfter: batch.quantity,
          requestStatus: "Synthetic Seed", inventoryStatus: "Available", administrationStatus: "Not Started",
          recordStatus: "Synthetic Demo", workflowStage: "1.2 Stock Management", eventType: "Synthetic Inventory Snapshot",
          notes: "Synthetic inventory fixture; no shipment or clinical stock is represented.", operationId: `SYNTHETIC-STOCK-${batch.batchId}`,
          isDemo: true, demoProvenance: { ...SYNTHETIC, reason: "Synthetic opening inventory snapshot" }, date: new Date() },
        $setOnInsert: { createdAt: new Date() },
      }, { upsert: true });
    }

    const history = buildSyntheticOrderHistory();
    for (const order of history) {
      const { orderId, createdAt, updatedAt, ...fields } = order;
      await Order.collection.updateOne({ orderId }, { $set: { ...fields, updatedAt }, $setOnInsert: { createdAt } }, { upsert: true });
    }
    console.log(`Seeded synthetic demo data: ${demoUsers.length} role accounts, ${demoBatches.length} batches and policies, ${demoBatches.length} inventory snapshots, ${history.length} monthly order records.`);
    console.log("Synthetic login emails:");
    for (const user of demoUsers) console.log(`  ${user.role}: ${user.email}`);
    console.log("All seeded accounts use the DEMO_SEED_PASSWORD configured for this local environment.");
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) seed().catch(error => {
  console.error(`Synthetic seed failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { buildSyntheticOrderHistory, demoUsers, demoBatches, seed };
