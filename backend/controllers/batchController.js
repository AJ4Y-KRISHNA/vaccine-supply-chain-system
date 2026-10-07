const Batch = require("../models/Batch");
const RawMaterial = require("../models/RawMaterial");
const Production = require("../models/Production");
const BatchReport = require("../models/BatchReport");
const Shipment = require("../models/Shipment");
const Distribution = require("../models/Distribution");
const Vaccination = require("../models/Vaccination");
const InventoryCertificate = require("../models/InventoryCertificate");
const TelemetryAnchor = require("../models/TelemetryAnchor");
const { registerBatchOnChain, getBatchFromChain, getBatchLifecycleFromChain, extractHash,
  getLatestTemperatureReadingFromChain, getBatchTemperatureHistoryFromChain,
  verifyTemperatureReadingOnChain, verifyTemperatureTransactionOnChain } = require("../services/blockchainService");

async function collectBatchTransactions(batchId) {
  const [batch, rawMaterials, productions, reports, shipments, distributions, vaccinations, certificates] = await Promise.all([
    Batch.findOne({ batchId }).lean(),
    RawMaterial.find({ batchId }).lean(),
    Production.find({ batchId }).lean(),
    BatchReport.find({ batchId }).lean(),
    Shipment.find({ batchId }).lean(),
    Distribution.find({ batchId }).lean(),
    Vaccination.find({ batchId }).lean(),
    InventoryCertificate.find({ batchId }).lean(),
  ]);

  const transactions = [];

  if (batch?.txHash) {
    transactions.push({
      source: "Batch",
      label: "Batch registration",
      txHash: batch.txHash,
      timestamp: batch.createdAt,
    });
  }

  rawMaterials.forEach((item) => {
    if (item.txHash) {
      transactions.push({
        source: "RawMaterial",
        label: item.materialType || "Raw material intake",
        txHash: item.txHash,
        timestamp: item.receivedAt,
      });
    }
  });

  productions.forEach((item) => {
    if (item.txHash) {
      transactions.push({
        source: "Production",
        label: item.vaccineType || "Production step",
        txHash: item.txHash,
        timestamp: item.producedAt,
      });
    }
  });

  reports.forEach((item) => {
    if (item.txHash) {
      transactions.push({
        source: "BatchReport",
        label: item.remarks || "Batch report",
        txHash: item.txHash,
        timestamp: item.createdAt,
      });
    }
  });

  certificates.forEach((item) => {
    if (item.txHash) {
      transactions.push({
        source: "InventoryCertificate",
        label: item.certificateId || "Inventory certificate",
        txHash: item.txHash,
        timestamp: item.issuedAt || item.createdAt,
      });
    }
  });

  shipments.forEach((item) => {
    if (item.txHash) {
      transactions.push({
        source: "Shipment",
        label: item.status || "Shipment update",
        txHash: item.txHash,
        timestamp: item.lastUpdatedAt || item.createdAt,
      });
    }

    (item.statusHistory || []).forEach((history) => {
      if (history.txHash) {
        transactions.push({
          source: "ShipmentHistory",
          label: history.status || "Shipment history",
          txHash: history.txHash,
          timestamp: history.timestamp,
        });
      }
    });
  });

  distributions.forEach((item) => {
    if (item.txHash) {
      transactions.push({
        source: "Distribution",
        label: item.decision || "Distribution decision",
        txHash: item.txHash,
        timestamp: item.timestamp,
      });
    }
  });

  vaccinations.forEach((item) => {
    if (item.txHash) {
      transactions.push({
        source: "Vaccination",
        label: item.eventType || item.workflowStage || "Vaccination step",
        txHash: item.txHash,
        timestamp: item.date,
      });
    }
  });

  const seen = new Set();
  return transactions
    .filter((item) => item.txHash)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .filter((item) => {
      if (seen.has(item.txHash)) return false;
      seen.add(item.txHash);
      return true;
    });
}

function keywordsForLifecycleAction(action = "") {
  const normalized = String(action).toLowerCase();
  if (normalized.includes("receive raw materials")) return ["raw material", "receive raw", "received"];
  if (normalized.includes("produce vaccine")) return ["production", "produced", "vaccine production"];
  if (normalized.includes("batch registered")) return ["batch registration", "register batch", "batch"];
  if (normalized.includes("create vaccine batch")) return ["batch registration", "batch created", "manufactured"];
  if (normalized.includes("mint inventory certificate")) return ["inventorycertificate", "inventory certificate", "certificate"];
  if (normalized.includes("smart inventory minting")) return ["inventorycertificate", "inventory certificate", "certificate"];
  if (normalized.includes("create batch report")) return ["batch report", "report", "remarks"];
  if (normalized.includes("release sign-off") || normalized.includes("sign-off")) return ["shipmenthistory", "sign", "release"];
  if (normalized.includes("release batch to supply chain")) return ["shipment", "released", "supply chain"];
  if (normalized.includes("receive vaccine batch")) return ["receive", "batch received"];
  if (normalized.includes("verify vaccine details")) return ["verify", "verification"];
  if (normalized.includes("update distribution information")) return ["distribution", "status update", "in transit"];
  if (normalized.includes("supply vaccination center")) return ["supplied", "delivered", "vaccination center"];
  if (normalized.includes("vaccine request")) return ["request", "requested"];
  if (normalized.includes("stock management")) return ["inventory", "stock", "update"];
  if (normalized.includes("administer vaccines")) return ["administer", "vaccination"];
  if (normalized.includes("record & report")) return ["report", "record"];
  if (normalized.includes("sentiment analysis")) return ["sentiment", "analysis"];
  return [];
}

function annotateLifecycleWithTransactions(lifecycle = [], transactions = []) {
  const orderedTransactions = [...transactions].sort(
    (a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
  );
  const used = new Set();

  return lifecycle.map((entry, index) => {
    const actionKeywords = keywordsForLifecycleAction(entry.action);
    let matchIndex = orderedTransactions.findIndex((transaction, candidateIndex) => {
      if (used.has(candidateIndex)) return false;
      const haystack = `${transaction.source || ""} ${transaction.label || ""}`.toLowerCase();
      return actionKeywords.some((keyword) => haystack.includes(keyword));
    });

    const match = matchIndex >= 0 ? orderedTransactions[matchIndex] : null;
    if (matchIndex >= 0) used.add(matchIndex);

    return {
      ...entry,
      transactionCorrelation: match ? "inferred-label-match-not-chain-proof" : "unmatched",
      txHash: match?.txHash || "",
      txLabel: match?.label || "",
      txSource: match?.source || "",
      txTimestamp: match?.timestamp || "",
    };
  });
}

// CREATE BATCH
const createBatch = async (req, res) => {
  try {

    const { batchId, vaccineType, quantity, manufacturer } = req.body;

    const receipt = await registerBatchOnChain(batchId, vaccineType, quantity);
    const txHash = extractHash(receipt);

    const batch = new Batch({
      batchId,
      vaccineType,
      quantity,
      manufacturer,
      expiresAt: req.body.expiresAt,
      txHash
    });

    await batch.save();

    res.json({
      message: "Batch registered on blockchain",
      txHash: txHash,
      batch
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Batch registration failed" });
  }
};


// VERIFY BATCH
const verifyBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const batch = await getBatchFromChain(batchId);
    if (!batch || !batch.batchId) return res.status(404).json({ message: "Batch not found on blockchain" });
    const chainEvidence = await getLatestTemperatureReadingFromChain(batchId);
    const { recordId, digest, transactionHash, chainId, contractAddress } = req.query;
    const hasProof = Boolean(recordId || digest || transactionHash || chainId || contractAddress);
    if (hasProof) {
      if (!/^0x[0-9a-f]{64}$/i.test(String(recordId || "")) || !/^0x[0-9a-f]{64}$/i.test(String(digest || "")) ||
          !/^0x[0-9a-f]{64}$/i.test(String(transactionHash || ""))) {
        return res.status(400).json({ error: "QR proof must include a valid record ID, digest and transaction hash" });
      }
      if (String(chainId) !== "31337" || String(contractAddress || "").toLowerCase() !== chainEvidence.contractAddress.toLowerCase()) {
        return res.status(409).json({ error: "QR proof identifies a different local chain or contract" });
      }
      if (!await verifyTemperatureTransactionOnChain(transactionHash, batchId, recordId, digest)) {
        return res.status(409).json({ error: "The QR transaction does not contain the matching local-chain temperature event" });
      }
      const reading = await verifyTemperatureReadingOnChain(batchId, recordId, digest);
      if (!reading) return res.status(409).json({ error: "The QR sensor record or digest does not match the local blockchain" });
      return res.json({ batchId: batch.batchId, vaccineType: batch.vaccineType, quantity: String(batch.quantity), status: batch.status,
        verified: true, chainId: chainEvidence.chainId, contractAddress: chainEvidence.contractAddress,
        telemetryCount: chainEvidence.total, telemetryVerified: true, verifiedReading: reading });
    }
    return res.json({ batchId: batch.batchId, vaccineType: batch.vaccineType, quantity: String(batch.quantity), status: batch.status,
      verified: true, chainId: chainEvidence.chainId, contractAddress: chainEvidence.contractAddress,
      telemetryCount: chainEvidence.total, latestReading: chainEvidence.latestReading, telemetryVerified: false });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Blockchain verification failed" });
  }
};

const getBatchVerificationPayload = async (req, res) => {
  try {
    const batch = await getBatchFromChain(req.params.batchId);
    if (!batch?.batchId) return res.status(404).json({ message: "Batch not found on blockchain" });
    const telemetry = await getLatestTemperatureReadingFromChain(req.params.batchId);
    let latestReading = telemetry.latestReading;
    if (latestReading?.recordId && latestReading.digest) {
      const anchor = await TelemetryAnchor.findOne({ batchId: batch.batchId, eventId: latestReading.recordId,
        rawDigest: latestReading.digest, rawChainStatus: "confirmed" })
        .select("rawTxHash rawChainId rawContractAddress").lean();
      if (anchor?.rawTxHash && anchor.rawChainId === telemetry.chainId &&
          anchor.rawContractAddress?.toLowerCase() === telemetry.contractAddress?.toLowerCase()) {
        latestReading = { ...latestReading, transactionHash: anchor.rawTxHash };
      }
    }
    return res.json({ batchId: batch.batchId, chainId: telemetry.chainId, contractAddress: telemetry.contractAddress,
      telemetryCount: telemetry.total, latestReading });
  } catch (_) { return res.status(503).json({ error: "Local-chain verification payload is unavailable" }); }
};

const getBatchOnChainTelemetry = async (req, res) => {
  const offset = req.query.offset == null ? 0 : Number(req.query.offset);
  const limit = req.query.limit == null ? 100 : Number(req.query.limit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    return res.status(400).json({ error: "Offset must be nonnegative and limit must be between 1 and 500" });
  }
  try {
    const history = await getBatchTemperatureHistoryFromChain(req.params.batchId, { offset, limit });
    return res.json(history);
  } catch (_) { return res.status(503).json({ error: "On-chain sensor history is unavailable" }); }
};

const getBatchLifecycle = async (req, res) => {
  try {
    const { batchId } = req.params;
    const lifecycle = await getBatchLifecycleFromChain(batchId);
    const transactions = await collectBatchTransactions(batchId);
    const timeline = annotateLifecycleWithTransactions(lifecycle.lifecycle, transactions);
    res.json({ ...lifecycle, timeline, transactions });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Blockchain lifecycle fetch failed"
    });
  }
};


module.exports = {
  createBatch,
  verifyBatch,
  getBatchVerificationPayload,
  getBatchOnChainTelemetry,
  getBatchLifecycle,
  collectBatchTransactions,
  annotateLifecycleWithTransactions,
};
