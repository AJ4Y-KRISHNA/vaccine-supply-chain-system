const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Vaccination = require("../models/Vaccination");
const { identityKeys, identityPatterns } = require("../middleware/identityScope");
const { withBatchLock } = require("./coldChainLock");

const terminalStates = new Set(["administered", "expired", "discarded", "recalled"]);
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
const isDoseCount = value => Number.isSafeInteger(value) && value >= 0;

function validateInput(body) {
  const allowed = new Set(["status", "reasonCode", "reason"]);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "A disposition object is required", "INVALID_DISPOSITION");
  if (Object.keys(body).some(key => !allowed.has(key))) throw fail(400, "Only status, reasonCode, and reason may be supplied", "INVALID_DISPOSITION_FIELDS");
  if (!terminalStates.has(body.status)) throw fail(400, "Disposition must be administered, expired, discarded, or recalled; active is the initial state only", "INVALID_DISPOSITION");
  if (typeof body.reasonCode !== "string" || !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(body.reasonCode.trim()) || body.reasonCode.trim().length > 80) {
    throw fail(400, "Provide a reason code in uppercase underscore format", "REASON_CODE_REQUIRED");
  }
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.trim().length > 500)) {
    throw fail(400, "Reason notes must be 500 characters or fewer", "INVALID_REASON");
  }
  return { status: body.status, reasonCode: body.reasonCode.trim(), reason: body.reason?.trim() || "" };
}

async function authorizeDisposition(user, batch, status) {
  if (user.role === "admin") return;

  if (user.role === "manufacturer") {
    if (!identityKeys(user).includes(String(batch.manufacturer || "").trim().toLowerCase())) throw fail(403, "Batch belongs to a different manufacturer", "BATCH_SCOPE_DENIED");
    if (["recalled", "expired", "discarded"].includes(status)) return;
  }

  if (user.role === "distributor" && ["expired", "discarded"].includes(status)) {
    const custody = await Shipment.exists({ batchId: batch.batchId, distributor: { $in: identityPatterns(user) }, hospitalConfirmed: { $ne: true } });
    if (!custody) throw fail(403, "This batch is not in the distributor's unconfirmed custody", "BATCH_SCOPE_DENIED");
    return;
  }

  if (user.role === "healthcare" && ["administered", "expired", "discarded"].includes(status)) {
    const received = await Shipment.exists({ batchId: batch.batchId, destination: { $in: identityPatterns(user) }, hospitalConfirmed: true });
    if (!received) throw fail(403, "A confirmed delivery to this hospital is required", "BATCH_SCOPE_DENIED");
    return;
  }

  throw fail(403, `Role cannot set batch disposition to ${status}`, "DISPOSITION_ROLE_DENIED");
}

async function assertFullyAdministered(batch) {
  if (!isDoseCount(batch.quantity) || batch.quantity <= 0) throw fail(409, "Batch quantity is not a valid positive dose count", "BATCH_QUANTITY_INVALID");
  const shipments = await Shipment.find({ batchId: batch.batchId, hospitalConfirmed: true }).lean();
  const receiptRows = await Vaccination.find({ batchId: batch.batchId, eventType: "Delivery Confirmation" }).lean();
  const receivedByShipment = new Map();
  for (const shipment of shipments) {
    if (!isDoseCount(shipment.quantity)) throw fail(409, "Shipment quantities must be reconciled before disposition", "BATCH_STOCK_UNRECONCILED");
    const amounts = receiptRows.filter(record => record.shipmentId === shipment.shipmentId).map(record => Number(record.receivedDoses || 0));
    const receipt = Math.min(shipment.quantity, Math.max(0, ...amounts.filter(isDoseCount)));
    receivedByShipment.set(shipment.shipmentId, receipt);
  }
  const totalReceived = [...receivedByShipment.values()].reduce((sum, amount) => sum + amount, 0);
  if (totalReceived !== batch.quantity) throw fail(409, "All batch doses must have a confirmed hospital delivery before marking the batch administered", "BATCH_STOCK_REMAINS");

  const administrations = await Vaccination.find({ batchId: batch.batchId }).lean();
  const used = administrations.filter(record => record.eventType === "Vaccination" || record.workflowStage === "1.3 Administer Vaccines" || record.administrationStatus === "Administered")
    .reduce((sum, record) => sum + Number(record.dosesUsed || 0), 0);
  if (!Number.isSafeInteger(used) || used !== batch.quantity) throw fail(409, "Every delivered dose must have a saved administration record before marking the batch administered", "BATCH_STOCK_REMAINS");
}

async function setBatchDisposition(batchId, body, user) {
  const input = validateInput(body);
  return withBatchLock(batchId, async () => {
    const batch = await Batch.findOne({ batchId });
    if (!batch) throw fail(404, "Batch not found", "BATCH_NOT_FOUND");

    await authorizeDisposition(user, batch, input.status);
    const current = batch.disposition?.status || "active";
    if (current !== "active") {
      if (current === input.status) return { batchId, disposition: batch.disposition.toObject?.() || batch.disposition, alreadySet: true };
      throw fail(409, `Batch disposition is already terminal (${current}) and cannot be changed`, "DISPOSITION_TERMINAL");
    }

    if (input.status === "expired" && (!batch.expiresAt || +new Date(batch.expiresAt) > Date.now())) {
      throw fail(409, "The batch expiry date has not passed", "BATCH_NOT_EXPIRED");
    }
    if (input.status === "administered") await assertFullyAdministered(batch);

    const recordedAt = new Date();
    const update = await Batch.updateOne({ batchId, $or: [
      { "disposition.status": "active" },
      { "disposition.status": { $exists: false } },
      { disposition: { $exists: false } },
    ] }, { $set: {
      "disposition.status": input.status,
      "disposition.reasonCode": input.reasonCode,
      "disposition.reason": input.reason,
      "disposition.recordedAt": recordedAt,
      "disposition.recordedBy": user.id,
      "disposition.recordedByRole": user.role,
    } }, { runValidators: true });
    if (!update.matchedCount) {
      const latest = await Batch.findOne({ batchId }).lean();
      if (latest?.disposition?.status === input.status) return { batchId, disposition: latest.disposition, alreadySet: true };
      throw fail(409, "Batch disposition changed concurrently; refresh and inspect the current record", "DISPOSITION_CONFLICT");
    }
    const saved = await Batch.findOne({ batchId }).lean();
    return { batchId, disposition: saved.disposition, alreadySet: false };
  });
}

module.exports = { setBatchDisposition, validateInput, assertFullyAdministered, terminalStates };
