function buildIntegrityReport({ batches, shipments, logs, orders, users }) {
  const normalize = value => String(value || "").trim().toLowerCase();
  const groups = rows => rows.reduce((map, row) => {
    const entries = map.get(row.batchId) || []; entries.push(row); map.set(row.batchId, entries); return map;
  }, new Map());
  const byBatch = groups(batches);
  const byShipment = new Map();
  for (const shipment of shipments) {
    const entries = byShipment.get(shipment.shipmentId) || []; entries.push(shipment); byShipment.set(shipment.shipmentId, entries);
  }
  const knownOwner = value => users.some(user => user.role === "manufacturer" &&
    [user.email, user.manufacturer].filter(Boolean).some(identity => normalize(identity) === normalize(value)));
  const orphanShipments = shipments.filter(s => !byBatch.has(s.batchId)).map(s => ({
    id: String(s._id), shipmentId: s.shipmentId, batchId: s.batchId, vaccineType: s.vaccineType, quantity: s.quantity,
  }));
  const unknownOwners = batches.filter(b => !knownOwner(b.manufacturer)).map(b => ({
    id: String(b._id), batchId: b.batchId, manufacturer: b.manufacturer || null,
  }));
  const orphanTelemetry = logs.filter(log => !byBatch.has(log.batchId)).map(log => ({
    id: String(log._id), batchId: log.batchId, shipmentId: log.shipmentId || null,
  }));
  const conflictingTelemetry = logs.filter(log => log.shipmentId &&
    (byShipment.get(log.shipmentId)?.length !== 1 || byShipment.get(log.shipmentId)[0].batchId !== log.batchId))
    .map(log => ({ id: String(log._id), batchId: log.batchId, shipmentId: log.shipmentId }));
  const duplicateBatchIds = [...byBatch].filter(([id, entries]) => !id || entries.length > 1)
    .map(([batchId, entries]) => ({ batchId: batchId || null, ids: entries.map(b => String(b._id)) }));
  const duplicateShipmentIds = [...byShipment].filter(([id, entries]) => !id || entries.length > 1)
    .map(([shipmentId, entries]) => ({ shipmentId: shipmentId || null, ids: entries.map(s => String(s._id)) }));
  const unallocatedApprovedOrders = orders.filter(order => order.status === "Approved" &&
    (!order.allocatedBatchId || !order.shipmentId || !byBatch.has(order.allocatedBatchId) ||
      !shipments.some(s => s.shipmentId === order.shipmentId && s.batchId === order.allocatedBatchId && s.orderId === order.orderId)))
    .map(order => ({ orderId: order.orderId, auditBatchId: order.auditBatchId, allocatedBatchId: order.allocatedBatchId || null }));
  const issues = { orphanShipments, unknownOwners, orphanTelemetry, conflictingTelemetry, duplicateBatchIds, duplicateShipmentIds, unallocatedApprovedOrders };
  return { readOnly: true, counts: { batches: batches.length, shipments: shipments.length, temperatureLogs: logs.length, orders: orders.length },
    issueCounts: Object.fromEntries(Object.entries(issues).map(([name, entries]) => [name, entries.length])), issues,
    nextAction: Object.values(issues).some(entries => entries.length)
      ? "Provide explicit record-ID-to-batch and batch-to-manufacturer mappings. Do not infer mappings from similar names or create replacement clinical records."
      : "No issues found by these seven relationship checks; this is not a clinical or comprehensive inventory certification." };
}

module.exports = { buildIntegrityReport };
