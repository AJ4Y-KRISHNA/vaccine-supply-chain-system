const { isDoseCount } = require("./inventoryEligibility");
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
function planSupply({ inventory, orders, destinations, transportCapacityDoses, asOf }) {
  const now = +new Date(asOf);
  if (!Number.isFinite(now)) fail("An explicit valid planning timestamp is required");
  if (!isDoseCount(transportCapacityDoses)) fail("Transport capacity must be a nonnegative whole number of doses");
  if (!Array.isArray(destinations) || !destinations.length || destinations.length > 100) fail("Select 1–100 pending orders with explicit capacity and transit inputs");
  const ids = new Set(), hospitalCapacities = new Map();
  const demands = destinations.map(input => {
    if (ids.has(input.orderId)) fail("Duplicate order selection"); ids.add(input.orderId);
    const order = orders.find(order => order.orderId === input.orderId);
    if (!order || order.status !== "Pending" || !isDoseCount(order.requestedDoses) || !order.requestedDoses) fail("Every selected order must be pending with positive whole doses");
    if (!isDoseCount(input.freeCapacityDoses) || !Number.isFinite(input.transitHours) || input.transitHours < 0 || input.transitHours > 8760) fail("Provide free destination capacity and transit hours (0–8760)");
    const hospital = String(order.hospital).trim().toLowerCase();
    if (hospitalCapacities.has(hospital) && hospitalCapacities.get(hospital) !== input.freeCapacityDoses) fail("Use the same shared free capacity for orders going to one hospital");
    hospitalCapacities.set(hospital, input.freeCapacityDoses);
    return { ...input, order, hospital, arrivalAt: now + input.transitHours * 3600000 };
  }).sort((a, b) => ({ Critical: 0, High: 1, Normal: 2, Low: 3 }[a.order.priority] ?? 2) -
    ({ Critical: 0, High: 1, Normal: 2, Low: 3 }[b.order.priority] ?? 2) || a.order.orderId.localeCompare(b.order.orderId));
  const excludedBatches = [], candidates = [];
  for (const batch of inventory) {
    const reasons = [...batch.reasons];
    const expiry = batch.expiresAt ? +new Date(batch.expiresAt) : NaN;
    if (!Number.isFinite(expiry)) reasons.push("EXPIRY_NOT_CONFIGURED");
    else if (expiry <= now) reasons.push("EXPIRED");
    if (!isDoseCount(batch.remainingDoses)) reasons.push("INVALID_STOCK_RECORDS");
    if (reasons.length) excludedBatches.push({ batchId: batch.batchId, reasons: [...new Set(reasons)] });
    else candidates.push({ ...batch, expiry, available: batch.remainingDoses });
  }
  candidates.sort((a, b) => a.expiry - b.expiry || a.batchId.localeCompare(b.batchId));
  const allocations = [], unfilled = [];
  let transportLeft = transportCapacityDoses;
  for (const demand of demands) {
    let remaining = demand.order.requestedDoses;
    for (const batch of candidates) {
      if (batch.vaccineType !== demand.order.vaccineType || batch.expiry <= demand.arrivalAt) continue;
      const quantity = Math.min(remaining, batch.available, hospitalCapacities.get(demand.hospital), transportLeft);
      if (!quantity) continue;
      allocations.push({ orderId: demand.orderId, hospital: demand.order.hospital, batchId: batch.batchId,
        vaccineType: batch.vaccineType, quantity, arrivalAt: new Date(demand.arrivalAt).toISOString(), expiresAt: new Date(batch.expiry).toISOString(),
        explanation: "Released, unheld matching product; earliest eligible expiry; bounded by order demand, batch stock, shared destination free capacity and transport capacity." });
      remaining -= quantity; batch.available -= quantity; transportLeft -= quantity;
      hospitalCapacities.set(demand.hospital, hospitalCapacities.get(demand.hospital) - quantity);
    }
    if (remaining) unfilled.push({ orderId: demand.orderId, doses: remaining, reason: "Insufficient eligible stock arriving before expiry, destination capacity or transport capacity" });
  }
  return { algorithm: "priority-then-FEFO-v1", advisoryOnly: true, asOf: new Date(now).toISOString(),
    allocations, unfilled, excludedBatches, totalAllocated: transportCapacityDoses - transportLeft,
    explanation: "Deterministic priority-first, first-expiry-first-out heuristic, not a globally optimal routing solver. Approved order quantities are the demand signal; historic forecasts are not trusted as measured demand.",
    execution: "No stock reserved or dispatch performed. Recheck through explicit order approval; split recommendations require separate supported orders, never silently overwrite an order." };
}
module.exports = { planSupply };
