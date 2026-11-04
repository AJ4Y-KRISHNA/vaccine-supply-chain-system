const { createHash } = require("node:crypto");
const { ObjectId } = require("mongoose").Types;
const VERSION = "user-confirmed-demo-20260917-v1";
const reason = "Project owner confirmed all historical records are demo/test data. Synthetic repair only; not clinical provenance or quality approval.";
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function planReconciliation(data) {
  const operations = [];
  const account = role => {
    const matches = data.users.filter(u => u.role === role);
    if (matches.length !== 1) throw new Error(`Expected exactly one demo ${role} account; explicit selection required`);
    return matches[0];
  };
  const maker = account("manufacturer"), distributor = account("distributor"), hospital = account("healthcare");
  const manufacturer = maker.manufacturer || maker.email;
  function change(collection, doc, fields, insert = false) {
    const after = Object.fromEntries(Object.entries(fields).filter(([field, value]) => insert || !equal(doc[field], value)));
    if (!Object.keys(after).length) return;
    const before = insert ? null : Object.fromEntries(Object.keys(after).map(field => [field, doc[field] === undefined ? { $missing: true } : doc[field]]));
    operations.push({ operationId: `${VERSION}:${collection}:${doc._id}`, targetCollection: collection, targetId: doc._id, before,
      after: insert ? { _id: doc._id, ...after } : after, reason });
  }
  const provenance = placeholders => ({ version: VERSION, classification: "synthetic-demo-only", placeholderFields: placeholders });
  const existing = new Map();
  for (const batch of data.batches) {
    if (!batch.batchId || existing.has(batch.batchId)) throw new Error("Ambiguous batch identifiers require manual review");
    existing.set(batch.batchId, batch);
  }
  const byShipment = new Map();
  for (const shipment of data.shipments) {
    if (!shipment.batchId || !shipment.shipmentId || byShipment.has(shipment.shipmentId)) throw new Error("Missing or duplicate shipment identifiers require manual review");
    byShipment.set(shipment.shipmentId, shipment);
  }
  for (const record of [...data.shipments, ...data.logs]) {
    if (!record.batchId) throw new Error("Telemetry without batch identifier requires explicit review");
    if (existing.has(record.batchId)) continue;
    const related = data.shipments.filter(s => s.batchId === record.batchId);
    const products = [...new Set(related.map(s => s.vaccineType).filter(Boolean))];
    if (products.length > 1) throw new Error(`Conflicting product labels for ${record.batchId}`);
    const quantity = related.reduce((sum, s) => sum + (Number.isSafeInteger(s.quantity) && s.quantity >= 0 ? s.quantity : 0), 0);
    const batch = { _id: new ObjectId(createHash("sha256").update(`${VERSION}:${record.batchId}`).digest().subarray(0, 12)),
      batchId: record.batchId, vaccineType: products[0] || "DEMO unspecified product", quantity, manufacturer,
      status: "Legacy demo placeholder — not released", releaseVisibleToExternal: false, productionApproved: false, labApproved: false,
      reportStatus: "Pending", isDemo: true, demoProvenance: provenance(["syntheticBatch", ...(!products.length ? ["vaccineType", "quantity"] : [])]) };
    change("batches", batch, batch, true);
    existing.set(batch.batchId, batch);
  }
  for (const batch of data.batches) {
    if (batch.demoProvenance?.version === VERSION) continue;
    change("batches", batch, { manufacturer, isDemo: true, demoProvenance: provenance([]) });
  }
  for (const shipment of data.shipments) {
    if (shipment.demoProvenance?.version === VERSION) continue;
    const placeholders = [];
    const fields = {};
    if (!shipment.vaccineType) { fields.vaccineType = existing.get(shipment.batchId).vaccineType; placeholders.push("vaccineType"); }
    if (!Number.isSafeInteger(shipment.quantity) || shipment.quantity < 0) { fields.quantity = 0; placeholders.push("quantity"); }
    const order = data.orders.find(o => `SHIP-${o.orderId}` === shipment.shipmentId);
    if (order) fields.orderId = order.orderId;
    change("shipments", shipment, { ...fields, isDemo: true, demoProvenance: provenance(placeholders) });
  }
  for (const order of data.orders) {
    if (order.demoProvenance?.version === VERSION) continue;
    const fields = { isDemo: true, demoProvenance: provenance([]) };
    if (order.status === "Approved") {
      const shipment = byShipment.get(`SHIP-${order.orderId}`);
      if (!shipment) throw new Error(`Approved demo order ${order.orderId} has no shipment; explicit review required`);
      Object.assign(fields, { allocatedBatchId: shipment.batchId, shipmentId: shipment.shipmentId, distributor: shipment.distributor });
    }
    change("orders", order, fields);
  }
  for (const log of data.logs) {
    if (log.demoProvenance?.version !== VERSION) change("temperaturelogs", log, { isDemo: true, demoProvenance: provenance([]) });
  }
  for (const [user, aliases] of [[distributor, data.shipments.map(s => s.distributor)],
    [hospital, [...data.shipments.map(s => s.destination), ...data.orders.flatMap(o => [o.hospital, o.centerId]),
      ...(data.vaccinations || []).flatMap(v => [v.hospital, v.centerId])]]]) {
    change("users", user, { organizationAliases: [...new Set([...(user.organizationAliases || []), ...aliases.filter(Boolean)])].sort() });
  }
  return operations;
}

async function applyReconciliation(connection, operations, Journal) {
  for (const planned of operations) {
    const existing = await Journal.findOne({ operationId: planned.operationId }).lean();
    const op = existing || (await Journal.create(planned)).toObject();
    // Resume from the original journal, never overwrite its before-image.
    const collection = connection.collection(op.targetCollection);
    if (op.before === null) {
      const current = await collection.findOne({ _id: op.targetId });
      if (current) {
        if (current.demoProvenance?.version !== VERSION || current.batchId !== op.after.batchId) throw new Error("Placeholder ID collision; no record overwritten");
      } else await collection.insertOne(op.after);
      continue;
    }
    const current = await collection.findOne({ _id: op.targetId });
    if (!current) throw new Error("Reconciliation target disappeared; stopping");
    if (Object.entries(op.after).every(([field, value]) => equal(current[field], value))) continue;
    const filter = { _id: op.targetId };
    for (const [field, value] of Object.entries(op.before)) filter[field] = value?.$missing ? { $exists: false } : value;
    const updated = await collection.updateOne(filter, { $set: op.after });
    if (updated.matchedCount !== 1) throw new Error(`Record changed since planning: ${op.operationId}; stopping without overwriting it`);
  }
}

module.exports = { VERSION, planReconciliation, applyReconciliation };
