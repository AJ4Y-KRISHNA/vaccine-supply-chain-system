const RawMaterial = require("../models/RawMaterial");
const Production = require("../models/Production");
const BatchReport = require("../models/BatchReport");
const Batch = require("../models/Batch");
const Distribution = require("../models/Distribution");
const Vaccination = require("../models/Vaccination");
const InventoryCertificate = require("../models/InventoryCertificate");
const { getForecast } = require("../services/aiService");
const {
  registerBatchOnChain,
  mintInventoryCertificateOnChain,
  approveBatchReleaseOnChain,
  logLifecycleEventOnChain,
  updateBatchStatusOnChain,
  extractHash,
} = require("../services/blockchainService");

function computeYield(quantity, materialQuantity) {
  if (!materialQuantity) return 95;
  const pct = Math.round((quantity / materialQuantity) * 100);
  return Math.max(1, Math.min(pct, 100));
}

function normaliseReleaseRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "production") return "Production";
  if (normalized === "lab" || normalized === "lab testing" || normalized === "lab-testing") return "Lab Testing";
  return "";
}

async function estimateDemandBaseline(vaccineType) {
  const [batches, distributions, vaccinations] = await Promise.all([
    Batch.find({ vaccineType }).sort({ createdAt: -1 }).limit(12).lean(),
    Distribution.find({}).sort({ timestamp: -1 }).limit(24).lean(),
    Vaccination.find({ vaccineType }).sort({ date: -1 }).limit(12).lean(),
  ]);

  const series = [
    ...batches.reverse().map((entry) => Number(entry.quantity || 0)),
    ...distributions
      .filter((entry) => String(entry.batchId || "").toLowerCase().includes(String(vaccineType || "").toLowerCase()) || entry.forecastDemand || entry.demand)
      .reverse()
      .map((entry) => Number(entry.forecastDemand || entry.demand || 0)),
    ...vaccinations.reverse().map((entry) => Number(entry.dosesUsed || entry.receivedDoses || 0)),
  ]
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(-12);

  if (series.length >= 4) {
    try {
      const forecast = await getForecast({ vaccination_data: series });
      return {
        predictedDemand: Number(forecast.predicted_demand || 0),
        sourceSeries: series,
      };
    } catch (_error) {
      // Fall through to average-based baseline if AI service is unavailable.
    }
  }

  const average = series.length
    ? Math.round(series.reduce((sum, value) => sum + value, 0) / series.length)
    : 0;
  return {
    predictedDemand: average,
    sourceSeries: series,
  };
}

async function mintInventoryCertificate({
  batchId,
  vaccineType,
  manufacturer,
  quantity,
}) {
  const { predictedDemand, sourceSeries } = await estimateDemandBaseline(vaccineType);
  const certificateId = `CERT-${batchId}`;
  const certificateUri = `manufacturer://${certificateId}`;

  let txHash = "";
  try {
    const receipt = await mintInventoryCertificateOnChain(
      batchId,
      vaccineType,
      predictedDemand,
      certificateUri
    );
    txHash = extractHash(receipt);
  } catch (chainErr) {
    console.warn("Inventory certificate mint skipped:", chainErr.message);
  }

  const certificate = await InventoryCertificate.findOneAndUpdate(
    { certificateId },
    {
      certificateId,
      batchId,
      vaccineType,
      manufacturer,
      predictedDemand,
      certificateUri,
      txHash,
      sourceSeries,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    certificate,
    predictedDemand,
    certificateId,
    certificateUri,
    certificateTxHash: txHash,
  };
}

async function syncBatchReleaseState(batch) {
  const fullyApproved = batch.productionApproved && batch.labApproved && batch.reportStatus === "Reported";
  batch.releaseVisibleToExternal = fullyApproved;
  batch.releaseStage = fullyApproved
    ? "Released to Supply Chain"
    : batch.productionApproved && batch.labApproved
    ? "Awaiting Final Quality Report"
    : batch.productionApproved
    ? "Awaiting Lab Testing Sign-Off"
    : batch.labApproved
    ? "Awaiting Production Sign-Off"
    : "Awaiting Production Sign-Off";
  batch.status = fullyApproved ? "Released to Supply Chain" : "Awaiting Multi-Sign Release";
  if (fullyApproved && !batch.releaseApprovedAt) {
    batch.releaseApprovedAt = new Date();
  }
  await batch.save();
  await InventoryCertificate.updateOne(
    { batchId: batch.batchId },
    { $set: { releaseVisibleToExternal: fullyApproved } }
  );
  await updateBatchStatusOnChain(batch.batchId, batch.status);
}

// 1.1 Receive raw materials
exports.receiveRawMaterials = async (req, res) => {
  try {
    const log = await RawMaterial.create({
      ...req.body,
      status: "Received",
    });

    const lifecycleReceipt = await logLifecycleEventOnChain({
      batchId: log.batchId || String(log._id),
      actorRole: "Manufacturer",
      action: "Receive Raw Materials",
      location: log.supplier || "Supplier",
      details: log.materialType || "Raw materials received",
      quantity: log.quantity || 0,
    });

    log.txHash = extractHash(lifecycleReceipt);
    await log.save();

    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 1.2 Produce vaccine
exports.produceVaccine = async (req, res) => {
  try {
    const prod = await Production.create({
      ...req.body,
      status: "Produced",
    });

    const lifecycleReceipt = await logLifecycleEventOnChain({
      batchId: req.body.batchId || String(prod._id),
      actorRole: "Manufacturer",
      action: "Produce Vaccine",
      location: req.body.manufacturer || "Manufacturer Plant",
      details: req.body.vaccineType || "Vaccine production completed",
      quantity: req.body.quantity || 0,
    });

    await Batch.updateOne(
      { batchId: req.body.batchId },
      {
        $set: {
          productionStatus: "Produced",
          status: "Production Complete",
        },
      },
      { upsert: false }
    );

    prod.txHash = extractHash(lifecycleReceipt);
    await prod.save();

    if (req.body.batchId) {
      await updateBatchStatusOnChain(req.body.batchId, "Production Complete");
    }

    res.json(prod);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 1.3 Create vaccine batch (DB + optional blockchain)
exports.createBatch = async (req, res) => {
  try {
    const { batchId, vaccineType, quantity } = req.body;

    let batch = await Batch.findOne({ batchId });
    if (!batch) {
      batch = await Batch.create({
        batchId,
        vaccineType,
        quantity,
        manufacturer: req.body.manufacturer || "Manufacturer",
        txHash: "",
        status: "Awaiting Multi-Sign Release",
        releaseStage: "Awaiting Production Sign-Off",
        productionStatus: "Produced",
      });
    } else {
      batch.vaccineType = vaccineType;
      batch.quantity = quantity;
      batch.manufacturer = req.body.manufacturer || batch.manufacturer;
      batch.status = "Awaiting Multi-Sign Release";
      batch.releaseStage = batch.releaseStage || "Awaiting Production Sign-Off";
      await batch.save();
    }

    // blockchain write (mock-safe if ABI missing)
    let txHash = "";
    try {
      const receipt = await registerBatchOnChain(batchId, vaccineType, quantity);
      txHash = extractHash(receipt);
    } catch (chainErr) {
      console.warn("Blockchain registerBatch skipped:", chainErr.message);
    }

    const lifecycleReceipt = await logLifecycleEventOnChain({
      batchId,
      actorRole: "Manufacturer",
      action: "Create Vaccine Batch",
      location: req.body.manufacturer || "Manufacturer Warehouse",
      details: vaccineType || "Batch created",
      quantity: quantity || 0,
    });

    const minting = await mintInventoryCertificate({
      batchId,
      vaccineType,
      manufacturer: batch.manufacturer,
      quantity,
    });

    await logLifecycleEventOnChain({
      batchId,
      actorRole: "Manufacturer",
      action: "Smart Inventory Minting",
      location: "Manufacturer Planning",
      details: `Baseline demand ${minting.predictedDemand}`,
      quantity: minting.predictedDemand,
    });

    await updateBatchStatusOnChain(batchId, "Awaiting Multi-Sign Release");

    if (txHash) {
      batch.txHash = txHash;
    }

    batch.txHash = batch.txHash || extractHash(lifecycleReceipt);
    batch.baselineDemandForecast = minting.predictedDemand;
    batch.certificateMinted = true;
    batch.certificateId = minting.certificateId;
    batch.certificateUri = minting.certificateUri;
    batch.certificateTxHash = minting.certificateTxHash;
    batch.certificateMintedAt = minting.certificate.issuedAt;
    batch.releaseVisibleToExternal = false;
    batch.status = "Awaiting Multi-Sign Release";
    await batch.save();

    res.json({
      batch,
      txHash,
      certificate: minting.certificate,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 1.4 Create batch report
exports.createBatchReport = async (req, res) => {
  try {
    const batch = await Batch.findOne({ batchId: req.body.batchId });
    const report = await BatchReport.create({
      ...req.body,
      txHash: batch?.txHash || "",
      status: "Reported",
      yieldRate: req.body.yieldRate || computeYield(req.body.quantity, req.body.materialQuantity),
    });

    const lifecycleReceipt = await logLifecycleEventOnChain({
      batchId: req.body.batchId || String(report._id),
      actorRole: "Manufacturer",
      action: "Create Batch Report",
      location: "Manufacturer Reporting",
      details: req.body.remarks || "Batch report generated",
      quantity: req.body.quantity || 0,
    });

    report.txHash = batch?.txHash || extractHash(lifecycleReceipt);
    await report.save();

    if (batch) {
      batch.reportStatus = "Reported";
      await syncBatchReleaseState(batch);
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DFD combined flow: Receive Raw Materials -> Produce Vaccine -> Create Batch -> Create Report
exports.runManufacturerWorkflow = async (req, res) => {
  try {
    const {
      batchId,
      vaccineType,
      quantity,
      manufacturer = "Manufacturer",
      supplier = "Supplier",
      materialType = "Raw Vaccine Material",
      materialQuantity = quantity,
      unit = "doses",
      remarks = "Auto-generated report",
    } = req.body;

    const rawMaterial = await RawMaterial.create({
      batchId,
      supplier,
      materialType,
      quantity: materialQuantity,
      unit,
      status: "Received",
    });

    const rawMaterialReceipt = await logLifecycleEventOnChain({
      batchId,
      actorRole: "Manufacturer",
      action: "Receive Raw Materials",
      location: supplier,
      details: materialType,
      quantity: materialQuantity,
    });
    rawMaterial.txHash = extractHash(rawMaterialReceipt);
    await rawMaterial.save();

    const production = await Production.create({
      batchId,
      vaccineType,
      quantity,
      manufacturer,
      materialsUsed: [
        {
          materialType,
          quantity: materialQuantity,
          unit,
        },
      ],
      status: "Produced",
    });

    const productionReceipt = await logLifecycleEventOnChain({
      batchId,
      actorRole: "Manufacturer",
      action: "Produce Vaccine",
      location: manufacturer,
      details: vaccineType,
      quantity,
    });
    production.txHash = extractHash(productionReceipt);
    await production.save();

    let batch = await Batch.findOne({ batchId });
    if (!batch) {
      batch = await Batch.create({
        batchId,
        vaccineType,
        quantity,
        manufacturer,
        status: "Batch Created",
        productionStatus: "Produced",
      });
    }

    let txHash = "";
    try {
      const receipt = await registerBatchOnChain(batchId, vaccineType, quantity);
      txHash = extractHash(receipt);
    } catch (chainErr) {
      console.warn("Manufacturer workflow blockchain skipped:", chainErr.message);
    }

    const batchReceipt = await logLifecycleEventOnChain({
      batchId,
      actorRole: "Manufacturer",
      action: "Create Vaccine Batch",
      location: manufacturer,
      details: vaccineType,
      quantity,
    });

    if (txHash) {
      batch.txHash = txHash;
    }
    batch.txHash = batch.txHash || extractHash(batchReceipt);
    batch.status = "Awaiting Multi-Sign Release";
    batch.releaseStage = "Awaiting Production Sign-Off";

    const minting = await mintInventoryCertificate({
      batchId,
      vaccineType,
      manufacturer,
      quantity,
    });

    batch.baselineDemandForecast = minting.predictedDemand;
    batch.certificateMinted = true;
    batch.certificateId = minting.certificateId;
    batch.certificateUri = minting.certificateUri;
    batch.certificateTxHash = minting.certificateTxHash;
    batch.certificateMintedAt = minting.certificate.issuedAt;
    batch.releaseVisibleToExternal = false;
    await batch.save();
    await updateBatchStatusOnChain(batchId, batch.status);

    await logLifecycleEventOnChain({
      batchId,
      actorRole: "Manufacturer",
      action: "Smart Inventory Minting",
      location: "Manufacturer Planning",
      details: `Baseline demand ${minting.predictedDemand}`,
      quantity: minting.predictedDemand,
    });

    const report = await BatchReport.create({
      batchId,
      vaccineType,
      quantity,
      yieldRate: computeYield(quantity, materialQuantity),
      wastageRate: Math.max(0, 100 - computeYield(quantity, materialQuantity)),
      txHash,
      status: "Reported",
      remarks,
    });

    const reportReceipt = await logLifecycleEventOnChain({
      batchId,
      actorRole: "Manufacturer",
      action: "Create Batch Report",
      location: "Manufacturer Reporting",
      details: remarks,
      quantity,
    });
    report.txHash = txHash || extractHash(reportReceipt);
    await report.save();

    batch.reportStatus = "Reported";
    await syncBatchReleaseState(batch);

    res.json({
      workflow: [
        { step: "1.1 Receive Raw Materials", status: rawMaterial.status },
        { step: "1.2 Produce Vaccine", status: production.status },
        { step: "1.3 Create Vaccine Batch", status: batch.status },
        { step: "1.4 Create Batch Report", status: report.status },
      ],
      rawMaterial,
      production,
      batch,
      report,
      certificate: minting.certificate,
      txHash,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.signBatchRelease = async (req, res) => {
  try {
    const { batchId } = req.params;
    const role = normaliseReleaseRole(req.body.role);
    const signer = req.body.signer || req.user?.id || "manufacturer-role";

    if (!role) {
      return res.status(400).json({ error: "Role must be Production or Lab Testing" });
    }

    const batch = await Batch.findOne({ batchId });
    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    if (role === "Production" && batch.productionApproved) {
      return res.status(400).json({ error: "Production sign-off already completed" });
    }

    if (role === "Lab Testing" && batch.labApproved) {
      return res.status(400).json({ error: "Lab Testing sign-off already completed" });
    }

    const receipt = await approveBatchReleaseOnChain(batchId, role);
    const txHash = extractHash(receipt);

    if (role === "Production") {
      batch.productionApproved = true;
      batch.productionApprovedAt = new Date();
      batch.productionSigner = signer;
    } else {
      batch.labApproved = true;
      batch.labApprovedAt = new Date();
      batch.labSigner = signer;
    }

    await logLifecycleEventOnChain({
      batchId,
      actorRole: "Manufacturer",
      action: `${role} Sign-Off`,
      location: "Quality Gate",
      details: signer,
      quantity: batch.quantity || 0,
    });

    await syncBatchReleaseState(batch);

    res.json({
      batch,
      txHash,
      releaseState: {
        productionApproved: batch.productionApproved,
        labApproved: batch.labApproved,
        releaseVisibleToExternal: batch.releaseVisibleToExternal,
        releaseStage: batch.releaseStage,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// List batches with reports (for Admin/Monitoring)
exports.getBatchDetails = async (_req, res) => {
  try {
    const rawMaterials = await RawMaterial.find(_req.scope.relatedBatch).sort({ receivedAt: -1 }).lean();
    const productions = await Production.find(_req.scope.relatedBatch).sort({ producedAt: -1 }).lean();
    const batches = await Batch.find(_req.scope.batch).sort({ createdAt: -1 }).lean();
    const reports = await BatchReport.find(_req.scope.relatedBatch).sort({ createdAt: -1 }).lean();
    const certificates = await InventoryCertificate.find(_req.scope.relatedBatch).sort({ issuedAt: -1 }).lean();
    res.json({ rawMaterials, productions, batches, reports, certificates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
