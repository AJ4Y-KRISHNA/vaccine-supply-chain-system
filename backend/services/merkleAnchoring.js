const mongoose = require("mongoose");
const Leaf = require("../models/MerkleLeaf"), Window = require("../models/MerkleWindow");
const Log = require("../models/TemperatureLog");
const tree = require("./merkleTree"), chain = require("./blockchainService"), logger = require("./structuredLogger");
const DEFAULT_WINDOW_SECONDS = 300, WINDOW_MS = DEFAULT_WINDOW_SECONDS * 1000, MAX_COUNT = 100;
function windowSeconds() {
  const configured = Number(process.env.MERKLE_WINDOW_SECONDS || DEFAULT_WINDOW_SECONDS);
  return Number.isInteger(configured) && configured >= 1 && configured <= 86400 ? configured : DEFAULT_WINDOW_SECONDS;
}
const windowMilliseconds = () => windowSeconds() * 1000;
let running = false;
async function stage(reading) {
  await Leaf.init();
  if (!reading.batchId || !Number.isFinite(reading.temperature)) throw new Error("Batch-linked finite telemetry required");
  const time = new Date(reading.recordedAt).getTime();
  if (!Number.isFinite(time)) throw new Error("Telemetry timestamp required");
  const duration = windowMilliseconds();
  const start = Math.floor(time / duration) * duration;
  const digest = tree.leafHash(reading);
  const leaf = await Leaf.findOneAndUpdate({ readingId: reading._id }, { $setOnInsert: {
    readingId: reading._id, batchId: reading.batchId, bucketStart: new Date(start), bucketEnd: new Date(start + duration),
    leafHash: digest, correlationId: reading.correlationId, synthetic: true,
  } }, { upsert: true, new: true });
  if (leaf.leafHash !== digest) throw new Error("Stored telemetry changed after Merkle staging");
  await require("./dashboardEventBus").publish({ type: "ANCHORING_STATUS", correlationId: reading.correlationId,
    shipmentId: reading.shipmentId, batchId: reading.batchId,
    data: { batchId: reading.batchId, shipmentId: reading.shipmentId || "", readingId: String(reading._id), status: "pending", synthetic: true } });
  return leaf;
}
async function makeWindow(batchId, bucketStart, now) {
  // A transaction assigns each unique reading to one immutable window snapshot.
  return mongoose.connection.transaction(async session => {
    const rows = await Leaf.find({ batchId, bucketStart, windowId: { $exists: false } }).sort({ readingId: 1 }).limit(MAX_COUNT).session(session).lean();
    if (!rows.length || (rows.length < MAX_COUNT && rows[0].bucketEnd > now)) return null;
    const built = tree.build(rows.map(row => row.leafHash));
    const windowId = tree.hash(tree.canonical({ schema: "synthetic-merkle-window-v1", batchId,
      bucketStart: bucketStart.toISOString(), readingIds: rows.map(row => String(row.readingId)), root: built.root }));
    const [window] = await Window.create([{ windowId, batchId, root: built.root,
      windowStart: rows[0].bucketStart, windowEnd: rows[0].bucketEnd, count: rows.length,
      readingIds: rows.map(row => row.readingId), correlationId: rows[0].correlationId }], { session });
    await Leaf.bulkWrite(rows.map((row, index) => ({ updateOne: { filter: { _id: row._id, windowId: { $exists: false } },
      update: { $set: { windowId, index, proof: built.proofs[index] } } } })), { session });
    return window;
  });
}
async function processOnce({ now = new Date(), limit = 50, forceRetry = false } = {}) {
  if (running) return { busy: true, confirmed: 0, failed: 0 };
  running = true;
  const result = { confirmed: 0, failed: 0 };
  try {
    await Promise.all([Leaf.init(), Window.init()]);
    const groups = await Leaf.aggregate([{ $match: { windowId: { $exists: false } } },
      { $group: { _id: { batchId: "$batchId", bucketStart: "$bucketStart" } } }, { $limit: limit }]);
    for (const group of groups) await makeWindow(group._id.batchId, group._id.bucketStart, now);
    const pending = await Window.find({ status: { $ne: "confirmed" }, ...(forceRetry ? {} : {
      $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
    }) }).sort({ windowStart: 1, _id: 1 }).limit(limit);
    for (const window of pending) {
      try {
        const leaves = await Leaf.find({ windowId: window.windowId }).sort({ index: 1 }).lean();
        if (leaves.length !== window.count || tree.build(leaves.map(row => row.leafHash)).root !== window.root) throw new Error("Stored Merkle snapshot integrity failure");
        const receipt = await chain.anchorSensorRoot(window);
        Object.assign(window, receipt, { status: "confirmed", confirmedAt: new Date(), lastError: undefined, nextAttemptAt: undefined });
        await window.save(); result.confirmed++;
        const shipmentIds = await Log.distinct("shipmentId", { _id: { $in: window.readingIds }, shipmentId: { $nin: [null, ""] } });
        await require("./dashboardEventBus").publishAnchoring(window, shipmentIds);
        logger.info("blockchain.merkle.anchored", { correlationId: window.correlationId, batchId: window.batchId,
          windowId: window.windowId, count: window.count, gasUsed: window.gasUsed, gasPerReading: window.gasPerReading });
      } catch (_) {
        window.status = "failed"; window.attempts++; window.nextAttemptAt = new Date(now.getTime() + Math.min(60000, 1000 * 2 ** Math.min(window.attempts, 6)));
        window.lastError = "Root not confirmed: inspect local contract availability and immutable snapshot before retry.";
        await window.save(); result.failed++;
        await require("./dashboardEventBus").publishAnchoring(window, []);
        logger.warn("blockchain.merkle.retry", { correlationId: window.correlationId, batchId: window.batchId, windowId: window.windowId, attempts: window.attempts });
      }
    }
    return result;
  } finally { running = false; }
}
async function verifyReading(reading) {
  const leaf = await Leaf.findOne({ readingId: reading._id }).lean();
  if (!leaf) return { readingId: String(reading._id), anchored: "pending", verified: false, proof: null };
  const digest = tree.leafHash(reading);
  if (digest !== leaf.leafHash) return { readingId: String(reading._id), anchored: "no", verified: false, tampered: true, leafHash: leaf.leafHash, computedLeafHash: digest };
  const window = leaf.windowId ? await Window.findOne({ windowId: leaf.windowId }).lean() : null;
  if (!window || window.status !== "confirmed") return { readingId: String(reading._id), anchored: "pending", verified: false, leafHash: digest,
    proof: leaf.proof, windowId: leaf.windowId || null, status: window?.status || "collecting" };
  if (window.chainId !== 31337 || window.contractAddress?.toLowerCase() !== chain.merkleAddress()?.toLowerCase()) {
    return { readingId: String(reading._id), anchored: "no", verified: false, tampered: true, error: "Saved evidence identifies a different contract or chain" };
  }
  let onChain;
  try { onChain = await chain.getSensorRoot(window.windowId, window.contractAddress); }
  catch (_) { return { readingId: String(reading._id), anchored: "pending", verified: false, error: "Local chain comparison unavailable" }; }
  const proof = (leaf.proof || []).map(({ side, hash }) => ({ side, hash }));
  const matches = onChain.root === window.root && onChain.batchId === reading.batchId && onChain.count === window.count
    && onChain.windowStart === new Date(window.windowStart).getTime() && onChain.windowEnd === new Date(window.windowEnd).getTime()
    && onChain.chainId === window.chainId && tree.verify(digest, proof, onChain.root);
  return { readingId: String(reading._id), anchored: matches ? "yes" : "no", verified: matches, tampered: !matches,
    leafHash: digest, proof, root: window.root, onChainRoot: onChain.root, rootMatches: matches,
    windowId: window.windowId, windowStart: window.windowStart, windowEnd: window.windowEnd, count: window.count,
    txHash: window.txHash, chainId: window.chainId, contractAddress: window.contractAddress,
    gasUsed: window.gasUsed, gasPerReading: window.gasPerReading };
}
module.exports = { stage, makeWindow, processOnce, verifyReading, WINDOW_MS, MAX_COUNT, windowSeconds, windowMilliseconds };
