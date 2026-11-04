const mongoose = require("mongoose");
const Log = require("../models/TemperatureLog"), Distribution = require("../models/Distribution");
const chain = require("../services/blockchainService"), merkle = require("../services/merkleAnchoring");
async function verifyBatch(req, res) {
  try {
    const batchId = req.params.batchId;
    const batch = await chain.getBatchFromChain(batchId);
    if (!batch) return res.status(404).json({ error: "Batch not registered on the local blockchain" });
    const match = { $and: [req.scope.telemetry, { batchId }] };
    const [summary, latest, distributions] = await Promise.all([
      Log.aggregate([{ $match: match }, { $group: { _id: null, count: { $sum: 1 }, minimum: { $min: "$temperature" },
        maximum: { $max: "$temperature" }, mean: { $avg: "$temperature" }, firstAt: { $min: "$recordedAt" }, lastAt: { $max: "$recordedAt" } } }]),
      Log.find(match).sort({ recordedAt: -1, _id: -1 }).limit(100).lean(),
      Distribution.find({ $and: [req.scope.distribution, { batchId }] }).sort({ timestamp: -1 }).limit(100).lean(),
    ]);
    const entries = await Promise.all(latest.map(merkle.verifyReading));
    const bad = entries.some(row => row.tampered), yes = entries.filter(row => row.verified).length;
    // Bounded verification is explicitly scoped: never claim all history was verified.
    const anchored = bad ? "no" : yes ? "yes" : latest.length ? "pending" : "no";
    return res.json({ ...batch, verified: true, synthetic: true, clinicalUse: false,
      batchVerification: "Batch verified", sensorEvidenceAnchored: anchored, integrityFailure: bad,
      historySummary: summary[0] ? { ...summary[0], _id: undefined } : { count: 0 },
      distributionRecords: distributions, distributionLimit: 100,
      evidence: entries, verifiedReadingsInPage: yes, pendingReadingsInPage: entries.filter(row => row.anchored === "pending").length, verificationLimit: 100,
      hasMoreReadings: (summary[0]?.count || 0) > latest.length,
      note: "Local synthetic demonstration only. Evidence state describes this page; use the reading endpoint to verify any older record." });
  } catch (_) { return res.status(503).json({ error: "Local batch verification unavailable" }); }
}
async function verifyReading(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Valid reading ID required" });
  try {
    const row = await Log.findOne({ $and: [req.scope.telemetry, { _id: req.params.id, batchId: req.params.batchId }] }).lean();
    if (!row) return res.status(404).json({ error: "Reading not found" });
    const batch = await chain.getBatchFromChain(req.params.batchId);
    if (!batch) return res.status(404).json({ error: "Batch not registered on the local blockchain" });
    const evidence = await merkle.verifyReading(row);
    const [summary, distributions] = await Promise.all([
      Log.aggregate([{ $match: { $and: [req.scope.telemetry, { batchId: req.params.batchId }] } },
        { $group: { _id: null, count: { $sum: 1 }, minimum: { $min: "$temperature" }, maximum: { $max: "$temperature" }, mean: { $avg: "$temperature" } } }]),
      Distribution.find({ $and: [req.scope.distribution, { batchId: req.params.batchId }] }).sort({ timestamp: -1 }).limit(100).lean(),
    ]);
    return res.json({ batch, reading: { id: String(row._id), temperature: row.temperature, humidity: row.humidity,
      recordedAt: row.recordedAt, location: row.location, vehicleId: row.vehicleId, shipmentId: row.shipmentId },
      ...evidence, historySummary: summary[0] || { count: 0 }, distributionRecords: distributions,
      sensorEvidenceAnchored: evidence.anchored, synthetic: true, clinicalUse: false });
  } catch (_) { return res.status(503).json({ error: "Reading verification unavailable" }); }
}
module.exports = { verifyBatch, verifyReading };
