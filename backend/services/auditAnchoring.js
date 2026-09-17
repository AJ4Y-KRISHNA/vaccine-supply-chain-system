const { createHash } = require("node:crypto");
const Audit = require("../models/ColdChainAudit");
const Anchor = require("../models/AuditAnchor");
const chain = require("./blockchainService");
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
let checking = false, timer;
async function processOnce(limit = 50) {
  if (checking) return { busy: true };
  checking = true;
  const result = { confirmed: 0, failed: 0 };
  try {
    // Append-only audit documents are the durable queue; only their hashes go on-chain.
    const rows = await Audit.aggregate([
      { $lookup: { from: Anchor.collection.name, localField: "_id", foreignField: "auditId", as: "anchor" } },
      { $match: { "anchor.status": { $ne: "confirmed" } } }, { $sort: { recordedAt: 1, _id: 1 } }, { $limit: limit }, { $unset: "anchor" },
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
      } catch (_) { anchor.status = "failed"; anchor.lastError = "Anchor not confirmed; check local chain configuration and evidence integrity before retry."; await anchor.save(); result.failed++; }
    }
    return result;
  } finally { checking = false; }
}
async function inspectBatch(batchId) {
  const audits = await Audit.find({ batchId }).sort({ recordedAt: -1 }).limit(200).lean();
  return Promise.all(audits.map(async audit => {
    const anchor = await Anchor.findOne({ auditId: audit._id }).lean(), payload = evidence(audit);
    let verified = false, error = null;
    if (anchor?.status === "confirmed") {
      try {
        verified = anchor.digest === payload.digest && anchor.contractAddress?.toLowerCase() === process.env.CONTRACT_ADDRESS?.toLowerCase()
          && await chain.verifyAuditOnChain(payload.eventId, payload.digest);
      } catch (_) { error = "Local chain unavailable"; }
    }
    return { auditId: audit._id, action: audit.action, anchor: anchor || null, verified, error };
  }));
}
function start() {
  if (timer || process.env.AUDIT_ANCHOR_ENABLED !== "true") return;
  timer = setInterval(() => processOnce().catch(() => {}), 5000); timer.unref?.();
}
function stop() { clearInterval(timer); timer = null; }
module.exports = { canonical, evidence, processOnce, inspectBatch, start, stop };
