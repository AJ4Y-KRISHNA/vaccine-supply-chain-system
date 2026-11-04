const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Alert = require("../models/TemperatureAlert");
const User = require("../models/user");

const key = value => String(value || "").trim().toLowerCase();
const isDoseCount = value => Number.isSafeInteger(value) && value >= 0;

// Conservative allocation accounting: every recorded shipment consumes capacity.
// No stock is silently returned by changing a free-text shipment status.
function assessBatch(batch, shipments, alerts, manufacturers) {
  const reasons = [];
  const assigned = shipments.filter(s => s.batchId === batch.batchId);
  const owner = key(batch.manufacturer);
  if (!owner || owner === "unknown" || !manufacturers.some(user =>
    [user.email, user.manufacturer].some(value => key(value) === owner))) reasons.push("OWNER_NOT_MAPPED");
  if (!batch.releaseVisibleToExternal || !batch.productionApproved || !batch.labApproved || batch.reportStatus !== "Reported") reasons.push("BATCH_NOT_RELEASED");
  if (batch.coldChainHoldAlertIds?.length || assigned.some(s => s.coldChainHoldAlertIds?.length) ||
    alerts.some(a => a.batchId === batch.batchId && a.requiresQualityReview)) reasons.push("COLD_CHAIN_HOLD");
  const disposition = batch.disposition?.status || "active";
  if (disposition !== "active") reasons.push(`BATCH_DISPOSITION_${String(disposition).toUpperCase()}`);
  if (!isDoseCount(batch.quantity) || assigned.some(s => !isDoseCount(s.quantity))) reasons.push("INVALID_STOCK_RECORDS");
  const assignedDoses = assigned.reduce((sum, s) => sum + (isDoseCount(s.quantity) ? s.quantity : 0), 0);
  const remainingDoses = isDoseCount(batch.quantity) ? Math.max(0, batch.quantity - assignedDoses) : 0;
  if (assignedDoses > batch.quantity) reasons.push("OVERALLOCATED_STOCK");
  if (!remainingDoses) reasons.push("NO_AVAILABLE_STOCK");
  if (batch.expiresAt && +new Date(batch.expiresAt) <= Date.now()) reasons.push("EXPIRED");
  return { batchId: batch.batchId, vaccineType: batch.vaccineType, manufacturer: batch.manufacturer,
    quantity: batch.quantity, expiresAt: batch.expiresAt, assignedDoses, remainingDoses, eligible: reasons.length === 0, reasons };
}

async function inventorySnapshot() {
  const [batches, shipments, alerts, manufacturers] = await Promise.all([
    Batch.find().lean(), Shipment.find().lean(), Alert.find({ requiresQualityReview: true }).lean(),
    User.find({ role: "manufacturer" }).select("email manufacturer").lean(),
  ]);
  const counts = new Map();
  for (const batch of batches) counts.set(batch.batchId, (counts.get(batch.batchId) || 0) + 1);
  const orphans = shipments.filter(s => counts.get(s.batchId) !== 1);
  return batches.map(batch => {
    const result = assessBatch(batch, shipments, alerts, manufacturers);
    if (counts.get(batch.batchId) !== 1) result.reasons.push("AMBIGUOUS_BATCH_ID");
    // An unlinked shipment of the same product may already consume this stock.
    if (orphans.some(s => !s.vaccineType || s.vaccineType === batch.vaccineType)) result.reasons.push("UNRECONCILED_SHIPMENTS");
    result.eligible = result.reasons.length === 0;
    return result;
  });
}

module.exports = { assessBatch, inventorySnapshot, isDoseCount, key };
