const { inventorySnapshot, isDoseCount } = require("./inventoryEligibility");

function buildForecastSupplyContext({ inventory = [], vaccineType = null, capturedAt = new Date() } = {}) {
  const normalizedType = value => String(value || "").trim().toLowerCase();
  const scoped = vaccineType
    ? inventory.filter(batch => normalizedType(batch.vaccineType) === normalizedType(vaccineType))
    : inventory;
  const counts = new Map();
  scoped.forEach(batch => counts.set(batch.batchId, (counts.get(batch.batchId) || 0) + 1));
  const unambiguous = scoped.filter(batch => batch.batchId && counts.get(batch.batchId) === 1 &&
    !batch.reasons?.includes("AMBIGUOUS_BATCH_ID"));
  const valid = unambiguous.filter(batch => isDoseCount(batch.remainingDoses));
  const totalUnallocated = valid.reduce((sum, batch) => sum + batch.remainingDoses, 0);
  const currentlyAvailable = valid.filter(batch => batch.eligible === true)
    .reduce((sum, batch) => sum + batch.remainingDoses, 0);
  const quarantineBatches = valid.filter(batch => batch.reasons?.includes("COLD_CHAIN_HOLD"));
  const quarantinedBatchIds = new Set(quarantineBatches.map(batch => batch.batchId));

  return {
    status: "available",
    scope: vaccineType ? "single vaccine type" : "all recorded vaccine types (pooled)",
    vaccine_type: vaccineType || null,
    total_unallocated_stock_doses: totalUnallocated,
    current_available_stock_doses: currentlyAvailable,
    active_quarantine_batch_count: quarantinedBatchIds.size,
    quarantined_unallocated_doses: quarantineBatches.reduce((sum, batch) => sum + batch.remainingDoses, 0),
    unavailable_unallocated_stock_doses: Math.max(0, totalUnallocated - currentlyAvailable),
    captured_at: new Date(capturedAt).toISOString(),
  };
}

async function getForecastSupplyContext(vaccineType = null) {
  const inventory = await inventorySnapshot();
  return buildForecastSupplyContext({ inventory, vaccineType });
}

module.exports = { buildForecastSupplyContext, getForecastSupplyContext };
