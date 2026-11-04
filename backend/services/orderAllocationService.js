const Order = require("../models/Order");
const Shipment = require("../models/Shipment");
const User = require("../models/user");
const Notification = require("../models/Notification");
const { inventorySnapshot, isDoseCount, key } = require("./inventoryEligibility");
const { withBatchLock } = require("./coldChainLock");
const { logLifecycleEventOnChain, extractHash } = require("./blockchainService");

const reviews = new Map();
async function withOrderLock(id, work) {
  const previous = reviews.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  reviews.set(id, current);
  try { return await current; } finally { if (reviews.get(id) === current) reviews.delete(id); }
}
function fail(status, code, message) { throw Object.assign(new Error(message), { status, code }); }

async function notifyDecision(order) {
  const approved = order.status === "Approved";
  const recipients = [{ role: "healthcare", ref: order.hospital }, ...(approved ? [{ role: "distributor", ref: order.distributor }] : [])];
  for (const recipient of recipients) {
    const deduplicationKey = `order:${order.orderId}:${order.status}:${recipient.role}:${recipient.ref}`;
    await Notification.updateOne({ deduplicationKey }, { $setOnInsert: {
      deduplicationKey, recipientRole: recipient.role, recipientRef: recipient.ref, orderId: order.orderId,
      auditBatchId: order.allocatedBatchId || order.auditBatchId,
      title: `Order ${order.status}`, message: `Order ${order.orderId}: ${order.status}. ${order.adminDecisionNote || ""}`,
      type: approved ? "success" : "error", metadata: { batchId: order.allocatedBatchId, shipmentId: order.shipmentId,
        txHash: order.approvalTxHash, status: order.status, requestedDoses: order.requestedDoses },
    } }, { upsert: true });
  }
}

async function reviewOrder({ orderId, decision, batchId, distributor, note = "", actorId }) {
  const normalized = typeof decision === "string" ? decision.toLowerCase() : "";
  if (!["approve", "decline"].includes(normalized)) fail(400, "INVALID_DECISION", "Decision must be Approve or Decline");
  if (typeof note !== "string" || note.length > 2000) fail(400, "INVALID_NOTE", "A decision note must be text, up to 2000 characters");
  return withOrderLock(orderId, async () => {
    const order = await Order.findOne({ orderId });
    if (!order) fail(404, "ORDER_NOT_FOUND", "Order not found");
    const desiredStatus = normalized === "approve" ? "Approved" : "Declined";
    if (order.status !== "Pending") {
      if (order.status !== desiredStatus || normalized === "approve" &&
        (order.allocatedBatchId !== batchId || order.distributor !== distributor || !order.shipmentId)) {
        fail(409, "ORDER_ALREADY_REVIEWED", "Order already reviewed; historical orders require explicit reconciliation");
      }
      await notifyDecision(order);
      return order;
    }
    const shipmentId = `SHIP-${order.orderId}`;
    const existing = await Shipment.findOne({ shipmentId });
    if (normalized === "decline") {
      if (existing) fail(409, "ALLOCATION_IN_PROGRESS", "A shipment already exists; recover its allocation before changing the decision");
      Object.assign(order, { status: "Declined", reviewedAt: new Date(), reviewedBy: actorId,
        adminDecisionNote: note, blockchainStatus: "Declined", distributorVisible: false });
      await order.save();
      await notifyDecision(order);
      return order;
    }
    if (typeof batchId !== "string" || !batchId.trim() || typeof distributor !== "string" || !distributor.trim()) {
      fail(400, "ALLOCATION_REQUIRED", "Select an existing batch and mapped distributor before approval");
    }
    if (!isDoseCount(order.requestedDoses) || order.requestedDoses === 0) fail(400, "INVALID_DOSES", "Requested doses must be a positive whole number");
    const distributors = await User.find({ role: "distributor" }).select("email distributor").lean();
    if (!distributors.some(user => [user.email, user.distributor].some(v => key(v) === key(distributor)))) {
      fail(400, "DISTRIBUTOR_NOT_MAPPED", "Select a distributor identity mapped to an existing account");
    }
    return withBatchLock(batchId, async () => {
      const options = await inventorySnapshot();
      const batch = options.find(b => b.batchId === batchId);
      if (!batch) fail(404, "BATCH_NOT_FOUND", "Batch not found");
      if (batch.vaccineType !== order.vaccineType) fail(400, "VACCINE_MISMATCH", "Batch vaccine type does not match this order");
      if (existing && (existing.orderId !== order.orderId || existing.batchId !== batchId ||
        existing.distributor !== distributor || existing.destination !== order.hospital || existing.quantity !== order.requestedDoses)) {
        fail(409, "SHIPMENT_CONFLICT", "Existing shipment does not match this allocation; reconcile it explicitly");
      }
      // A persisted shipment reserves its doses even if the later order save fails.
      const blocking = batch.reasons.filter(r => !(existing && r === "NO_AVAILABLE_STOCK"));
      if (blocking.length) fail(409, blocking.includes("COLD_CHAIN_HOLD") ? "COLD_CHAIN_HOLD" : "BATCH_INELIGIBLE", `Batch cannot be allocated: ${blocking.join(", ")}`);
      if (!existing && batch.remainingDoses < order.requestedDoses) fail(409, "INSUFFICIENT_STOCK", "Selected batch has insufficient unassigned doses");
      let shipment = existing;
      if (!shipment) {
        const receipt = await logLifecycleEventOnChain({ batchId, actorRole: "Admin", action: "Approve Vaccine Order",
          location: order.region || order.hospital, details: `Order ${order.orderId} allocated to ${batchId}`, quantity: order.requestedDoses });
        const hash = extractHash(receipt);
        const txHash = receipt?.status === 1 && /^0x[a-fA-F0-9]{64}$/.test(hash || "") ? hash : "";
        shipment = await Shipment.create({ shipmentId, orderId: order.orderId, batchId, vaccineType: batch.vaccineType,
          quantity: order.requestedDoses, source: batch.manufacturer, distributor, destination: order.hospital,
          status: "New Shipment Required", txHash, statusHistory: [{ status: "New Shipment Required", timestamp: new Date(), txHash }] });
      }
      Object.assign(order, { allocatedBatchId: batchId, shipmentId, distributor, status: "Approved", reviewedAt: new Date(),
        reviewedBy: actorId, adminDecisionNote: note, distributorVisible: true, approvalTxHash: shipment.txHash,
        blockchainStatus: shipment.txHash ? "Approved On-Chain" : "Approved — blockchain unverified" });
      await order.save();
      await notifyDecision(order);
      return order;
    });
  });
}

module.exports = { reviewOrder };
