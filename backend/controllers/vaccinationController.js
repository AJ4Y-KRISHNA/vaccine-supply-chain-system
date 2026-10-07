const Vaccination = require("../models/Vaccination");
const Batch = require("../models/Batch");
const { confirmedBatchStock, prepareAdministration, administrationReplay, completeAdministrationOperation } = require("../services/healthcareInventory");
const {
  recordOnBlockchain,
  logLifecycleEventOnChain,
  updateBatchStatusOnChain,
  extractHash,
} = require("../services/blockchainService");

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// 1.1 Vaccine Request
exports.requestVaccines = async (req, res) => {
  try {
    const {
      centerId,
      hospital,
      vaccineType = "Mixed",
      requestedDoses = 0,
      stockBefore = 0,
      notes = "",
    } = req.body;

    const request = await Vaccination.create({
      centerId: centerId || hospital,
      hospital: hospital || centerId,
      vaccineType,
      requestedDoses: safeNumber(requestedDoses),
      stockBefore: safeNumber(stockBefore),
      stockAfter: safeNumber(stockBefore),
      requestStatus: "Requested",
      inventoryStatus: "Awaiting Supply",
      workflowStage: "1.1 Vaccine Request",
      eventType: "Vaccine Request",
      notes,
      source: "manual", enteredBy: String(req.user?.id || ""), note: notes,
    });

    const lifecycleReceipt = await logLifecycleEventOnChain({
      batchId: req.body.batchId || String(request._id),
      actorRole: "Vaccination Center",
      action: "Vaccine Request",
      location: centerId || hospital || "Vaccination Center",
      details: vaccineType,
      quantity: requestedDoses,
    });
    request.txHash = extractHash(lifecycleReceipt);
    request.blockchainStatus = request.txHash ? "Logged" : "Pending";
    await request.save();

    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 1.2 Stock Management / inventory update
exports.updateInventory = async (req, res) => {
  try {
    // Inventory enters the hospital exactly once through the confirmed-delivery
    // endpoint. Legacy callers may inspect that receipt, not invent new stock.
    const stock = await confirmedBatchStock(req);
    const receipt = stock.records.find(record => record.eventType === "Delivery Confirmation" && record.shipmentId === req.body.shipmentId);
    if (!receipt) return res.status(409).json({ error: "Confirm the supplied shipment using the delivery receipt action before updating inventory" });
    return res.json({ ...receipt, alreadyRecorded: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

// 1.3 Administer vaccines
exports.administerVaccines = async (req, res) => {
  try {
    const replay = await administrationReplay(req, "administer");
    if (replay) return res.json(replay);
    await prepareAdministration(req);
    const {
      centerId,
      hospital,
      batchId,
      vaccineType = "Mixed",
      patientName = "Patient",
      dosesUsed = 0,
      stockBefore = 0,
      notes = "",
    } = req.body;

    const stockAfter = Math.max(0, safeNumber(stockBefore) - safeNumber(dosesUsed));

    const record = await Vaccination.create({
      ...req.administrationOperation,
      centerId: centerId || hospital,
      hospital: hospital || centerId,
      batchId,
      vaccineType,
      patientName,
      dosesUsed: safeNumber(dosesUsed),
      stockBefore: safeNumber(stockBefore),
      stockAfter,
      administrationStatus: "Administered",
      workflowStage: "1.3 Administer Vaccines",
      eventType: "Vaccination",
      notes,
      source: "manual", enteredBy: String(req.user?.id || ""), note: notes,
    });

    const lifecycleReceipt = await logLifecycleEventOnChain({
      batchId: batchId || String(record._id),
      actorRole: "Vaccination Center",
      action: "Administer Vaccines",
      location: centerId || hospital || "Vaccination Center",
      details: patientName || vaccineType,
      quantity: dosesUsed,
    });
    record.txHash = extractHash(lifecycleReceipt);
    record.blockchainStatus = record.txHash ? "Logged" : "Pending";
    await record.save();

    if (batchId) {
      await updateBatchStatusOnChain(batchId, "Administered");
      // Manufactured quantity stays unchanged; hospital usage is a separate ledger.
      await Batch.updateOne({ batchId }, { $set: { status: "Administered" } });
    }

    await completeAdministrationOperation(record, record.toObject());
    const result = record.toObject();
    delete result.operationResult;
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
};

// 1.4 Record & Report to blockchain / health authority
exports.recordAndReport = async (req, res) => {
  try {
    const stock = await confirmedBatchStock(req);
    const reportDoses = Number(req.body.dosesUsed);
    if (!Number.isSafeInteger(reportDoses) || reportDoses <= 0 || reportDoses > stock.used) return res.status(400).json({ error: "Reports must refer to doses already administered in this hospital" });
    req.body.vaccineType = stock.batch.vaccineType;
    const {
      centerId,
      hospital,
      batchId,
      vaccineType = "Mixed",
      dosesUsed = 0,
      healthAuthority = "Health Authority",
      notes = "",
    } = req.body;

    const receipt = await recordOnBlockchain({
      batchId,
      targetCenter: healthAuthority || centerId || hospital,
      recommended_units: safeNumber(dosesUsed),
      status: "Vaccination Recorded",
      details: "Vaccination report submitted to health authority",
    });

    const txHash = extractHash(receipt) || "pending";

    await logLifecycleEventOnChain({
      batchId: batchId || String(Date.now()),
      actorRole: "Vaccination Center",
      action: "Record & Report",
      location: healthAuthority || centerId || hospital || "Health Authority",
      details: notes || "Vaccination report generated",
      quantity: dosesUsed,
    });

    const report = await Vaccination.create({
      centerId: centerId || hospital,
      hospital: hospital || centerId,
      batchId,
      vaccineType,
      dosesUsed: safeNumber(dosesUsed),
      healthAuthority,
      txHash,
      blockchainStatus: txHash === "pending" ? "Pending" : "Logged",
      recordStatus: "Reported",
      workflowStage: "1.4 Record & Report",
      eventType: "Vaccination Report",
      notes,
      source: "manual", enteredBy: String(req.user?.id || ""), note: notes,
    });

    if (batchId) {
      await updateBatchStatusOnChain(batchId, "Vaccination Recorded");
    }

    res.json(report);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

// End-to-end vaccination center DFD flow
exports.runVaccinationWorkflow = async (req, res) => {
  try {
    const replay = await administrationReplay(req, "workflow");
    if (replay) return res.json(replay);
    await prepareAdministration(req);
    const {
      centerId = "City Hospital",
      hospital = centerId,
      shipmentId = "",
      batchId,
      vaccineType = "Mixed",
      requestedDoses = 100,
      receivedDoses = 100,
      dosesUsed = 50,
      stockBefore = 0,
      patientName = "Patient",
      healthAuthority = "Health Authority",
      notes = "Vaccination center workflow",
    } = req.body;

    const request = await Vaccination.create({
      centerId,
      hospital,
      vaccineType,
      requestedDoses: safeNumber(requestedDoses),
      stockBefore: safeNumber(stockBefore),
      stockAfter: safeNumber(stockBefore),
      requestStatus: "Requested",
      inventoryStatus: "Awaiting Supply",
      workflowStage: "1.1 Vaccine Request",
      eventType: "Vaccine Request",
      notes,
      source: "manual", enteredBy: String(req.user?.id || ""), note: notes,
    });
    const requestReceipt = await logLifecycleEventOnChain({
      batchId: batchId || String(request._id),
      actorRole: "Vaccination Center",
      action: "Vaccine Request",
      location: centerId,
      details: vaccineType,
      quantity: requestedDoses,
    });
    request.txHash = extractHash(requestReceipt);
    request.blockchainStatus = request.txHash ? "Logged" : "Pending";
    await request.save();

    const stockAfterDelivery = safeNumber(stockBefore) + safeNumber(receivedDoses);
    const inventory = await Vaccination.create({
      centerId,
      hospital,
      shipmentId,
      batchId,
      vaccineType,
      receivedDoses: safeNumber(receivedDoses),
      stockBefore: safeNumber(stockBefore),
      stockAfter: stockAfterDelivery,
      requestStatus: "Fulfilled",
      inventoryStatus: "Updated",
      workflowStage: "1.2 Stock Management",
      eventType: "Inventory Update",
      notes,
      source: "manual", enteredBy: String(req.user?.id || ""), note: notes,
    });
    const inventoryReceipt = await logLifecycleEventOnChain({
      batchId: batchId || shipmentId || String(inventory._id),
      actorRole: "Vaccination Center",
      action: "Stock Management",
      location: centerId,
      details: vaccineType,
      quantity: receivedDoses,
    });
    inventory.txHash = extractHash(inventoryReceipt);
    inventory.blockchainStatus = inventory.txHash ? "Logged" : "Pending";
    await inventory.save();
    if (batchId) {
      await updateBatchStatusOnChain(batchId, "Delivered to Vaccination Center");
    }

    const stockAfterAdministration = Math.max(0, stockAfterDelivery - safeNumber(dosesUsed));
    const administration = await Vaccination.create({
      ...req.administrationOperation,
      centerId,
      hospital,
      batchId,
      vaccineType,
      patientName,
      dosesUsed: safeNumber(dosesUsed),
      stockBefore: stockAfterDelivery,
      stockAfter: stockAfterAdministration,
      administrationStatus: "Administered",
      workflowStage: "1.3 Administer Vaccines",
      eventType: "Vaccination",
      notes,
      source: "manual", enteredBy: String(req.user?.id || ""), note: notes,
    });
    const administrationReceipt = await logLifecycleEventOnChain({
      batchId: batchId || String(administration._id),
      actorRole: "Vaccination Center",
      action: "Administer Vaccines",
      location: centerId,
      details: patientName || vaccineType,
      quantity: dosesUsed,
    });
    administration.txHash = extractHash(administrationReceipt);
    administration.blockchainStatus = administration.txHash ? "Logged" : "Pending";
    await administration.save();
    if (batchId) {
      await updateBatchStatusOnChain(batchId, "Administered");
    }

    const receipt = await recordOnBlockchain({
      batchId,
      targetCenter: healthAuthority || centerId,
      recommended_units: safeNumber(dosesUsed),
      status: "Vaccination Recorded",
      details: "Vaccination workflow report submitted",
    });

    const txHash = extractHash(receipt) || "pending";

    await logLifecycleEventOnChain({
      batchId: batchId || String(Date.now()),
      actorRole: "Vaccination Center",
      action: "Record & Report",
      location: healthAuthority || centerId,
      details: notes,
      quantity: dosesUsed,
    });

    const report = await Vaccination.create({
      centerId,
      hospital,
      batchId,
      vaccineType,
      dosesUsed: safeNumber(dosesUsed),
      healthAuthority,
      txHash,
      blockchainStatus: txHash === "pending" ? "Pending" : "Logged",
      recordStatus: "Reported",
      workflowStage: "1.4 Record & Report",
      eventType: "Vaccination Report",
      notes,
      source: "manual", enteredBy: String(req.user?.id || ""), note: notes,
    });
    if (batchId) {
      await updateBatchStatusOnChain(batchId, "Vaccination Recorded");
    }

    const result = {
      workflow: [
        { step: "1.1 Vaccine Request", status: request.requestStatus },
        { step: "1.2 Stock Management", status: inventory.inventoryStatus },
        { step: "1.3 Administer Vaccines", status: administration.administrationStatus },
        { step: "1.4 Record & Report", status: report.recordStatus },
      ],
      request,
      inventory,
      administration: administration.toObject(),
      report,
      txHash,
    };
    await completeAdministrationOperation(administration, result);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
};

exports.createRecord = async (req, res) => {
  // Keep the legacy URL, but route it through the same stock and receipt guards.
  if (req.body.eventType === "Vaccination Report") return exports.recordAndReport(req, res);
  if (["Inventory Update", "Delivery Confirmation"].includes(req.body.eventType)) return exports.updateInventory(req, res);
  if (!req.body.eventType || req.body.eventType === "Vaccination") return exports.administerVaccines(req, res);
  return res.status(400).json({ error: "Use the vaccine request, confirmed delivery, administration, or report action for this event" });
};

exports.getRecords = async (_req, res) => {
  try {
    const records = await Vaccination.find(_req.scope.vaccination).select("-operationResult -operationFingerprint").sort({ date: -1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getWorkflowStatus = async (_req, res) => {
  try {
    const records = await Vaccination.find(_req.scope.vaccination).select("-operationResult -operationFingerprint").sort({ date: -1 }).lean();
    const requests = records.filter((item) => item.workflowStage === "1.1 Vaccine Request");
    const inventory = records.filter((item) => item.workflowStage === "1.2 Stock Management");
    const administrations = records.filter((item) => item.workflowStage === "1.3 Administer Vaccines");
    const reports = records.filter((item) => item.workflowStage === "1.4 Record & Report");

    res.json({
      requests,
      inventory,
      administrations,
      reports,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
