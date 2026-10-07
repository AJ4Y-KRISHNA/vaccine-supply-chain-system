const { createHash } = require("node:crypto");
const Audit = require("../models/ColdChainAudit");
const Anchor = require("../models/AuditAnchor");
const TemperatureLog = require("../models/TemperatureLog");
const TelemetryAnchor = require("../models/TelemetryAnchor");
const chain = require("./blockchainService");
const logger = require("./structuredLogger");
const hash = value => `0x${createHash("sha256").update(value).digest("hex")}`;
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function evidence(audit) {
  const plain = JSON.parse(JSON.stringify(audit));
  delete plain.__v;
  return { eventId: hash(`cold-chain-audit:v1:${plain._id}`), digest: hash(canonical({ schema: "cold-chain-audit-v1", record: plain })) };
}
function telemetryEvidence(reading) {
  const plain = JSON.parse(JSON.stringify(reading));
  const fields = ["_id", "batchId", "shipmentId", "sensorId", "deviceId", "vehicleId", "sequenceNumber", "correlationId", "source",
    "enteredBy", "note", "needsReview", "supersedes", "overrideId", "operatorUserId", "temperature", "humidity", "batteryLevel", "recordedAt", "location", "simulation"];
  const record = Object.fromEntries(fields.filter(field => Object.hasOwn(plain, field)).map(field => [field, plain[field]]));
  return { eventId: hash("cold-chain-telemetry:v1:" + plain._id), digest: hash(canonical({ schema: "cold-chain-telemetry-v1", record })) };
}
let checking = false, timer;
async function processOnce(limit = 50, filter = {}) {
  if (checking) return { busy: true };
  checking = true;
  const result = { confirmed: 0, failed: 0 };
  const budget = Math.max(0, Math.floor(limit));
  const auditLimit = Math.ceil(budget / 2);
  const telemetryLimit = Math.floor(budget / 2);
  try {
    // Append-only audit documents are the durable queue; only their hashes go on-chain.
    const rows = await Audit.aggregate([
      ...(filter.alertIds ? [{ $match: { alertId: { $in: filter.alertIds } } }] : []),
      { $lookup: { from: Anchor.collection.name, localField: "_id", foreignField: "auditId", as: "anchor" } },
      { $match: { "anchor.status": { $ne: "confirmed" } } }, { $sort: { recordedAt: 1, _id: 1 } }, { $limit: auditLimit }, { $unset: "anchor" },
    ]);
    for (const audit of rows) {
      const payload = evidence(audit);
      const anchor = await Anchor.findOneAndUpdate({ auditId: audit._id }, { $setOnInsert: { auditId: audit._id, batchId: audit.batchId, ...payload } }, { upsert: true, new: true });
      try {
        if (anchor.digest !== payload.digest) throw new Error("Audit changed since queueing");
        const receipt = await chain.anchorAuditOnChain(payload.eventId, payload.digest);
        anchor.status = "confirmed"; anchor.txHash = receipt.txHash || anchor.txHash;
        anchor.chainId = receipt.chainId; anchor.contractAddress = receipt.contractAddress; anchor.confirmedAt = new Date(); anchor.lastError = undefined;
        await anchor.save(); result.confirmed++;
        logger.info("blockchain.audit.anchored", { correlationId: audit.correlationId, batchId: audit.batchId,
          anchorId: String(anchor._id) });
      } catch (_) { anchor.status = "failed"; anchor.lastError = "Anchor not confirmed; check local chain configuration and evidence integrity before retry."; await anchor.save(); result.failed++;
        logger.warn("blockchain.audit.anchor_failed", { correlationId: audit.correlationId, batchId: audit.batchId }); }
    }
    // Persisted readings stay in MongoDB; each reading's canonical digest is
    // separately anchored so the local chain can reveal later record changes.
    if (process.env.TELEMETRY_ANCHOR_MODE !== "legacy") {
      const Leaf = require("../models/MerkleLeaf");
      const readings = await TemperatureLog.aggregate([
        ...(filter.readingId ? [{ $match: { _id: filter.readingId } }] : []),
        { $match: { batchId: { $type: "string", $ne: "" } } },
        { $lookup: { from: Leaf.collection.name, localField: "_id", foreignField: "readingId", as: "leaf" } },
        { $lookup: { from: TelemetryAnchor.collection.name, localField: "_id", foreignField: "readingId", as: "legacy" } },
        { $match: { "leaf.0": { $exists: false }, "legacy.status": { $ne: "confirmed" } } },
        { $sort: { recordedAt: 1, _id: 1 } }, { $limit: telemetryLimit }, { $unset: ["leaf", "legacy"] },
      ]);
      for (const reading of readings) await require("./merkleAnchoring").stage(reading);
      const windows = await require("./merkleAnchoring").processOnce({ limit: Math.max(1, telemetryLimit) });
      result.confirmed += windows.confirmed; result.failed += windows.failed;
      return result;
    }
    const readings = await TemperatureLog.aggregate([
      ...(filter.readingId ? [{ $match: { _id: filter.readingId } }] : []),
      { $lookup: { from: TelemetryAnchor.collection.name, localField: "_id", foreignField: "readingId", as: "anchor" } },
      { $match: { batchId: { $type: "string", $ne: "" }, $or: [
        { "anchor.status": { $ne: "confirmed" } }, { "anchor.rawChainStatus": { $ne: "confirmed" } },
      ] } },
      { $sort: { recordedAt: 1, _id: 1 } }, { $limit: telemetryLimit }, { $unset: "anchor" },
    ]);
    for (const reading of readings) {
      const payload = telemetryEvidence(reading);
      const anchor = await TelemetryAnchor.findOneAndUpdate({ readingId: reading._id }, { $setOnInsert: {
        readingId: reading._id, batchId: reading.batchId, ...payload,
      } }, { upsert: true, new: true });
      let stage = "digest";
      try {
        if (anchor.digest !== payload.digest) throw new Error("Temperature reading changed since queueing");
        if (anchor.status !== "confirmed") {
          const receipt = await chain.anchorAuditOnChain(payload.eventId, payload.digest);
          anchor.status = "confirmed"; anchor.txHash = receipt.txHash || anchor.txHash;
          anchor.chainId = receipt.chainId; anchor.contractAddress = receipt.contractAddress;
          anchor.confirmedAt = new Date(); anchor.lastError = undefined;
          await anchor.save();
        }
        stage = "raw";
        const rawPayload = chain.prepareTemperatureReading({ ...reading, recordId: payload.eventId });
        if (anchor.rawDigest && anchor.rawDigest !== rawPayload.digest) throw new Error("Raw telemetry changed since queueing");
        if (anchor.rawChainStatus !== "confirmed") {
          anchor.rawDigest = rawPayload.digest;
          anchor.rawChainStatus = "pending";
          anchor.rawLastError = undefined;
          await anchor.save();
          const receipt = await chain.recordTemperatureReadingOnChain({ ...reading, recordId: payload.eventId });
          anchor.rawChainStatus = "confirmed"; anchor.rawTxHash = receipt.txHash || anchor.rawTxHash;
          anchor.rawChainId = receipt.chainId; anchor.rawContractAddress = receipt.contractAddress || process.env.CONTRACT_ADDRESS;
          anchor.rawConfirmedAt = new Date(); anchor.rawLastError = undefined;
          await anchor.save();
        }
        result.confirmed++;
        logger.info("blockchain.telemetry.anchored", { correlationId: reading.correlationId, batchId: reading.batchId,
          temperatureLogId: String(reading._id) });
      } catch (_) {
        if (stage === "raw") {
          anchor.rawChainStatus = "failed";
          anchor.rawLastError = "Raw reading not confirmed; check local chain configuration and retry status before use.";
        } else {
          anchor.status = "failed";
          anchor.lastError = "Reading digest not confirmed; check local chain configuration and evidence integrity before retry.";
        }
        await anchor.save(); result.failed++;
        logger.warn("blockchain.telemetry.anchor_failed", { correlationId: reading.correlationId,
          batchId: reading.batchId, stage });
      }
    }
    return result;
  } finally { checking = false; }
}
async function inspectBatch(batchId) {
  const [audits, readings] = await Promise.all([
    Audit.find({ batchId }).sort({ recordedAt: -1 }).limit(200).lean(),
    TemperatureLog.find({ batchId }).sort({ recordedAt: -1 }).limit(200).lean(),
  ]);
  const auditEntries = await Promise.all(audits.map(async audit => {
    const anchor = await Anchor.findOne({ auditId: audit._id }).lean(), payload = evidence(audit);
    let verified = false, error = null;
    if (anchor?.status === "confirmed") {
      try {
        verified = anchor.digest === payload.digest && anchor.contractAddress?.toLowerCase() === process.env.CONTRACT_ADDRESS?.toLowerCase()
          && await chain.verifyAuditOnChain(payload.eventId, payload.digest);
      } catch (_) { error = "Local chain unavailable"; }
    }
    return { kind: "audit", recordId: audit._id, recordedAt: audit.recordedAt, action: audit.action, anchor: anchor || null, verified, error };
  }));
  const telemetryEntries = await Promise.all(readings.map(async reading => {
    const anchor = await TelemetryAnchor.findOne({ readingId: reading._id }).lean(), payload = telemetryEvidence(reading);
    if (!anchor && process.env.TELEMETRY_ANCHOR_MODE !== "legacy") {
      const proof = await require("./merkleAnchoring").verifyReading(reading);
      return { kind: "temperature-reading", recordId: reading._id, recordedAt: reading.recordedAt,
        verified: proof.verified, error: proof.error || null, merkle: proof };
    }
    let verified = false, error = null, rawReading = null, rawError = null;
    if (anchor?.status === "confirmed") {
      try {
        verified = anchor.digest === payload.digest && anchor.contractAddress?.toLowerCase() === process.env.CONTRACT_ADDRESS?.toLowerCase()
          && await chain.verifyAuditOnChain(payload.eventId, payload.digest);
      } catch (_) { error = "Local chain unavailable"; }
    }
    if (anchor?.rawChainStatus === "confirmed" && anchor.rawDigest) {
      try {
        rawReading = await chain.verifyTemperatureReadingOnChain(reading.batchId, anchor.eventId, anchor.rawDigest);
        if (!rawReading) rawError = "Raw chain fields or digest do not match the saved telemetry evidence.";
      } catch (_) { rawError = "Local chain unavailable"; }
    }
    return { kind: "temperature-reading", recordId: reading._id, recordedAt: reading.recordedAt, anchor: anchor || null, verified, error,
      rawChain: { status: anchor?.rawChainStatus || "pending", digest: anchor?.rawDigest || null,
        txHash: anchor?.rawTxHash || null, verified: Boolean(rawReading), reading: rawReading, error: rawError } };
  }));
  return [...auditEntries, ...telemetryEntries].sort((left, right) => new Date(right.recordedAt || 0) - new Date(left.recordedAt || 0));
}
function start() {
  if (timer || process.env.AUDIT_ANCHOR_ENABLED !== "true") return;
  timer = setInterval(() => processOnce().catch(() => {}), 5000); timer.unref?.();
}
function stop() { clearInterval(timer); timer = null; }
module.exports = { canonical, evidence, telemetryEvidence, processOnce, inspectBatch, start, stop };
