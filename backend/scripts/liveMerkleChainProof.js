const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Batch = require("../models/Batch");
const Log = require("../models/TemperatureLog");
const Window = require("../models/MerkleWindow");
const chain = require("../services/blockchainService");
const merkle = require("../services/merkleAnchoring");

async function main() {
  assert.ok(process.env.DEMO_SEED_PASSWORD, "DEMO_SEED_PASSWORD is required");
  await mongoose.connect(process.env.MONGO_URI);
  const batchId = `PHASE8-LIVE-${Date.now()}`;
  const reading = await Log.create({ batchId, deviceId: `${batchId}-SENSOR`, vehicleId: "SYNTHETIC-TRUCK-PHASE8",
    temperature: 5.4, humidity: 58, batteryLevel: 91, location: { lat: 9.9, lng: 76.3 },
    source: "manual", enteredBy: "synthetic-phase8-proof", note: "Synthetic live-chain proof; not clinical data",
    recordedAt: new Date(Date.now() - 60000), isDemo: true, demoProvenance: "phase8-running-hardhat-proof" });
  await chain.registerBatchOnChain(batchId, "Synthetic Phase 8 verification fixture", 1);
  await Batch.create({ batchId, vaccineType: "Synthetic Phase 8 verification fixture", manufacturer: "Synthetic Demo Manufacturer",
    quantity: 1, status: "In Transit", isDemo: true });
  await merkle.stage(reading);
  const processed = await merkle.processOnce({ now: new Date(Date.now() + 60000), forceRetry: true });
  assert.equal(processed.failed, 0);
  assert.ok(processed.confirmed > 0, "The running Hardhat chain must confirm a Merkle root transaction");
  const window = await Window.findOne({ batchId }).lean();
  assert.equal(window.status, "confirmed");
  assert.ok(window.txHash);

  const login = await fetch("http://127.0.0.1:5000/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.synthetic.test", password: process.env.DEMO_SEED_PASSWORD, role: "admin" }) });
  assert.equal(login.status, 200, "Seeded synthetic admin login is required for verification endpoint proof");
  const { token } = await login.json();
  const verify = async () => fetch(`http://127.0.0.1:5000/api/verify/${batchId}/reading/${reading._id}`, {
    headers: { authorization: `Bearer ${token}` } });
  const verifiedResponse = await verify();
  assert.equal(verifiedResponse.status, 200);
  const verified = await verifiedResponse.json();
  assert.equal(verified.verified, true);
  assert.equal(verified.txHash, window.txHash);

  await Log.collection.updateOne({ _id: reading._id }, { $set: { temperature: 12.4 } });
  const tamperedResponse = await verify();
  assert.equal(tamperedResponse.status, 200);
  const tampered = await tamperedResponse.json();
  assert.equal(tampered.verified, false);
  assert.equal(tampered.tampered, true);
  await Log.collection.updateOne({ _id: reading._id }, { $set: { temperature: 5.4 } });
  const restoredResponse = await verify();
  assert.equal(restoredResponse.status, 200);
  const restored = await restoredResponse.json();
  assert.equal(restored.verified, true);

  console.log(JSON.stringify({ result: "PASS", synthetic: true, chainId: window.chainId, batchId,
    readingId: String(reading._id), root: window.root, txHash: window.txHash, contractAddress: window.contractAddress,
    gasUsed: window.gasUsed, gasPerReading: window.gasPerReading, configuredWindowSeconds: merkle.windowSeconds(),
    verificationEndpoint: verified.verified, tamperRejected: tampered.tampered, restoredVerification: restored.verified }));
  await mongoose.disconnect();
}

main().catch(async error => { console.error(error.stack || error.message); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });
