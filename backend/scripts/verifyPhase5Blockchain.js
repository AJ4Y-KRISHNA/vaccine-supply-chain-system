const assert = require("node:assert/strict");
const Batch = require("../models/Batch"), Log = require("../models/TemperatureLog");
const chain = require("../services/blockchainService"), merkle = require("../services/merkleAnchoring");
module.exports = async function verifyPhase5(call) {
  const id = "SYNTHETIC-MERKLE-" + Date.now();
  const noId = id + "-EMPTY";
  for (const batchId of [id, noId]) {
    await chain.registerBatchOnChain(batchId, "Synthetic Merkle fixture", 10);
    await Batch.create({ batchId, vaccineType: "Synthetic Merkle fixture", manufacturer: "Synthetic Test Manufacturer", quantity: 10, isDemo: true });
  }
  await chain.logLifecycleEventOnChain({ batchId: id, actorRole: "Distributor", action: "Synthetic transport test", quantity: 10,
    shipmentId: "SYNTHETIC-SHIP", vehicleId: "SYNTHETIC-TRUCK", routeId: "KOCHI-SYNTHETIC-ROUTE" });
  const lifecycle = await chain.getBatchLifecycleFromChain(id);
  const transports = [...lifecycle.lifecycle, ...lifecycle.transportLifecycle];
  assert.ok(transports.some(row => row.shipmentId === "SYNTHETIC-SHIP" && row.vehicleId === "SYNTHETIC-TRUCK" && row.routeId === "KOCHI-SYNTHETIC-ROUTE"));
  const now = Date.now();
  // Closed-window fixtures pass the actual telemetry validator and device-key HTTP route.
  const input = Array.from({ length: 3 }, (_, i) => ({ batchId: id, deviceId: id + "-DEVICE", vehicleId: "SYNTHETIC-TRUCK",
    sequenceNumber: i, temperature: 5 + i / 10, humidity: 60, batteryLevel: 90, recordedAt: new Date(now - 600000 + i * 1000).toISOString(),
    location: { lat: 9.9, lng: 76.3 }, source: "auto-simulated", simulation: { source: "phase5-synthetic-acceptance", tick: i } }));
  await call("POST", "/temperature/ingest", "device", input);
  if (require("../services/eventBackbone").enabled()) {
    const Receipt = require("../models/EventReceipt");
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const persisted = await Log.find({ batchId: id }).lean();
      const staged = await require("../models/MerkleLeaf").countDocuments({ batchId: id });
      const completed = await Receipt.countDocuments({ eventId: { $in: persisted.map(row => row.eventId) }, group: "anchoring" });
      if (staged === 3 && completed === 3) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(await require("../models/MerkleLeaf").countDocuments({ batchId: id }), 3, "Redis anchoring group staged accepted readings");
    const rows = await Log.find({ batchId: id }).lean();
    assert.equal(await Receipt.countDocuments({ eventId: { $in: rows.map(row => row.eventId) }, group: "anchoring" }), 3);
  }
  const readings = await Log.find({ batchId: id }).sort({ recordedAt: 1 }); assert.equal(readings.length, 3);
  const none = await call("GET", "/verify/" + noId, "admin");
  assert.equal(none.verified, true); assert.equal(none.sensorEvidenceAnchored, "no");
  const pending = await call("GET", "/verify/" + id, "admin"); assert.equal(pending.sensorEvidenceAnchored, "pending");
  for (const row of readings) await merkle.stage(row);
  const anchored = await merkle.processOnce({ forceRetry: true }); assert.ok(anchored.confirmed >= 1); assert.equal(anchored.failed, 0);
  const verified = await call("GET", "/verify/" + id, "admin"); assert.equal(verified.sensorEvidenceAnchored, "yes");
  assert.ok(verified.evidence.every(row => row.verified && row.gasPerReading > 0));
  const reading = await call("GET", `/verify/${id}/reading/${readings[0]._id}`, "admin");
  assert.equal(reading.verified, true); assert.equal(reading.root, reading.onChainRoot); assert.ok(Array.isArray(reading.proof));
  // Mutate only the isolated test record. Immutable root/proof must NOT be rebuilt.
  await Log.collection.updateOne({ _id: readings[0]._id }, { $set: { temperature: 12.5 } });
  const tampered = await call("GET", `/verify/${id}/reading/${readings[0]._id}`, "admin");
  assert.equal(tampered.verified, false); assert.equal(tampered.tampered, true); assert.equal(tampered.sensorEvidenceAnchored, "no");
  assert.equal((await call("GET", "/verify/" + id, "admin")).integrityFailure, true);
  await Log.collection.updateOne({ _id: readings[0]._id }, { $set: { temperature: 5 } });
  assert.equal((await call("GET", "/verify/" + id, "admin")).sensorEvidenceAnchored, "yes");
  await merkle.processOnce();
  const windows = await require("../models/MerkleWindow").find({ batchId: id }).lean();
  assert.equal(windows.length, 1);
  return { outcome: "PASS", synthetic: true, batchId: id, noEvidenceBatchId: noId, readingCount: 3,
    tamperRejected: true, root: windows[0].root, gasUsed: windows[0].gasUsed, gasPerReading: windows[0].gasPerReading,
    verificationUrl: "/verify/" + id, noEvidenceVerificationUrl: "/verify/" + noId };
};
