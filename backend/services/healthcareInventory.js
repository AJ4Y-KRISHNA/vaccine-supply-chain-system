const Vaccination = require("../models/Vaccination");
const Shipment = require("../models/Shipment");
const Batch = require("../models/Batch");
const { identityPatterns } = require("../middleware/identityScope");
const { createHash } = require("crypto");

const failure = (status, message) => Object.assign(new Error(message), { status });

async function confirmedBatchStock(req) {
  const { batchId } = req.body;
  const batch = await Batch.findOne({ batchId }).lean();
  if (!batch) throw failure(404, "Batch not found");
  if (!batch.releaseVisibleToExternal || !batch.productionApproved || !batch.labApproved || batch.reportStatus !== "Reported") throw failure(409, "Batch is not released for administration");
  if (req.body.vaccineType && req.body.vaccineType !== batch.vaccineType) throw failure(400, "Vaccine type does not match the batch");
  const hospital = req.body.hospital || req.body.centerId || req.user?.hospital || req.user?.email;
  const patterns = req.user?.role === "admin" ? [hospital] : identityPatterns(req.user);
  if (!hospital) throw failure(400, "Hospital identity is required");
  const [shipments, records] = await Promise.all([
    Shipment.find({ batchId, hospitalConfirmed: true, destination: { $in: patterns } }).lean(),
    Vaccination.find({ batchId, $or: [{ hospital: { $in: patterns } }, { centerId: { $in: patterns } }] }).lean(),
  ]);
  let received = 0;
  for (const shipment of shipments) {
    const receipts = records.filter(record => record.shipmentId === shipment.shipmentId && record.eventType === "Delivery Confirmation");
    const amounts = receipts.map(record => Number(record.receivedDoses || 0));
    const amount = Math.min(Number(shipment.quantity || 0), Math.max(0, ...amounts));
    if (Number.isSafeInteger(amount) && amount >= 0) received += amount;
  }
  const used = records.filter(record => record.eventType === "Vaccination" || record.workflowStage === "1.3 Administer Vaccines" || record.administrationStatus === "Administered")
    .reduce((total, record) => total + Number(record.dosesUsed || 0), 0);
  if (!Number.isSafeInteger(received) || !Number.isSafeInteger(used) || used < 0 || used > received) throw failure(409, "Hospital inventory requires reconciliation before administration");
  return { batch, hospital, received, used, available: received - used, records };
}

async function prepareAdministration(req) {
  const doses = Number(req.body.dosesUsed);
  if (!Number.isSafeInteger(doses) || doses <= 0) throw failure(400, "Doses used must be a positive whole number");
  const stock = await confirmedBatchStock(req);
  if (doses > stock.available) throw failure(409, "Insufficient confirmed hospital stock. Confirm the distributor delivery before administration.");
  // Never accept client-provided inventory as proof that doses exist.
  req.body = { ...req.body, hospital: stock.hospital, centerId: stock.hospital,
    vaccineType: stock.batch.vaccineType, dosesUsed: doses, stockBefore: stock.available,
    receivedDoses: 0, requestedDoses: 0 };
  return stock;
}

async function administrationReplay(req, mode) {
  if (req.body.operationId === undefined) return null;
  if (typeof req.body.operationId !== "string" || !/^[A-Za-z0-9_-]{8,120}$/.test(req.body.operationId)) throw failure(400, "Invalid vaccination operation identifier");
  const hospital = req.body.hospital || req.body.centerId || req.user?.hospital || req.user?.email;
  const fingerprint = createHash("sha256").update(JSON.stringify({ mode, hospital,
    actor: req.user?.id, batchId: req.body.batchId, dosesUsed: Number(req.body.dosesUsed),
    patientName: req.body.patientName || "Patient", healthAuthority: req.body.healthAuthority || "Health Authority",
    notes: req.body.notes || "", vaccineType: req.body.vaccineType || "" })).digest("hex");
  const existing = await Vaccination.findOne({ hospital, operationId: req.body.operationId }).lean();
  if (existing) {
    if (existing.operationFingerprint !== fingerprint) throw failure(409, "This operation identifier was already used for different vaccination input");
    if (existing.operationStatus !== "complete" || !existing.operationResult) throw Object.assign(failure(409, "This vaccination was already recorded, but its blockchain/report step is incomplete. Inspect the existing administration; do not administer again."), { code: "VACCINATION_OPERATION_INCOMPLETE" });
    return { ...existing.operationResult, alreadyRecorded: true };
  }
  req.administrationOperation = { operationId: req.body.operationId, operationFingerprint: fingerprint, operationStatus: "pending" };
  return null;
}

async function completeAdministrationOperation(record, result) {
  if (!record.operationId) return;
  record.operationStatus = "complete";
  record.operationResult = JSON.parse(JSON.stringify(result));
  await record.save();
}

module.exports = { confirmedBatchStock, prepareAdministration, administrationReplay, completeAdministrationOperation, failure };
