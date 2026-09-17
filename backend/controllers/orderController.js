const Order = require("../models/Order");
const Notification = require("../models/Notification");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Vaccination = require("../models/Vaccination");
const { getForecast, getSentiment } = require("../services/aiService");
const {
  logLifecycleEventOnChain,
  extractHash,
} = require("../services/blockchainService");

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRole(value) {
  return String(value || "").toLowerCase();
}

function buildAuditBatchId(orderId) {
  return `ORDER-${String(orderId).replace(/[^a-zA-Z0-9-]/g, "").toUpperCase()}`;
}

function inferRiskFlag({ sentimentScore, forecastDemand, availableStock, requestedDoses }) {
  if (sentimentScore < 0.4 || forecastDemand > availableStock || requestedDoses > availableStock) {
    return "High";
  }
  if (sentimentScore < 0.6 || forecastDemand > availableStock * 0.75) {
    return "Medium";
  }
  return "Low";
}

async function createNotification(payload) {
  return Notification.create(payload);
}

exports.createHospitalOrder = async (req, res) => {
  try {
    const {
      hospital,
      centerId,
      region,
      vaccineType = "Covid-19",
      requestedDoses = 0,
      priority = "Normal",
      notes = "",
    } = req.body;

    const normalizedHospital = hospital || centerId || "Healthcare Center";
    const normalizedRegion = region || normalizedHospital;
    const orderId = `ORD-${Date.now()}`;
    const auditBatchId = buildAuditBatchId(orderId);

    const availableStock = await Batch.aggregate([
      { $match: { vaccineType } },
      { $group: { _id: null, total: { $sum: "$quantity" } } },
    ]).then((rows) => safeNumber(rows[0]?.total));

    const vaccinationHistory = await Vaccination.find({
      $or: [{ hospital: normalizedHospital }, { centerId: centerId || normalizedHospital }],
      vaccineType,
    })
      .sort({ date: -1 })
      .limit(12)
      .lean();

    const historySeries = vaccinationHistory
      .reverse()
      .map((entry) => safeNumber(entry.dosesUsed || entry.receivedDoses))
      .filter((value) => value >= 0);

    let forecastDemand = 0;
    if (historySeries.filter((value) => value > 0).length >= 4) {
      try {
        const forecast = await getForecast({ vaccination_data: historySeries });
        forecastDemand = safeNumber(forecast.predicted_demand);
      } catch (_error) {
        forecastDemand = 0;
      }
    }

    let sentimentScore = 0.5;
    let sentimentLabel = "Neutral";
    try {
      const sentiment = await getSentiment(
        `${normalizedRegion} ${vaccineType} vaccine supply request. ${notes}`.trim()
      );
      sentimentScore = Number(sentiment.score ?? sentiment.sentiment_score ?? 0.5);
      sentimentLabel = sentiment.sentiment || sentiment.label || "Neutral";
    } catch (_error) {
      sentimentScore = 0.5;
      sentimentLabel = "Neutral";
    }

    const riskFlag = inferRiskFlag({
      sentimentScore,
      forecastDemand,
      availableStock,
      requestedDoses: safeNumber(requestedDoses),
    });

    const order = await Order.create({
      orderId,
      auditBatchId,
      hospital: normalizedHospital,
      centerId: centerId || normalizedHospital,
      region: normalizedRegion,
      vaccineType,
      requestedDoses: safeNumber(requestedDoses),
      priority,
      notes,
      status: "Pending",
      sentimentScore,
      sentimentLabel,
      riskFlag,
      forecastDemand,
      availableStock,
      distributorVisible: false,
      blockchainStatus: "Pending",
    });

    await createNotification({
      recipientRole: "healthcare",
      recipientRef: normalizedHospital,
      orderId: order.orderId,
      auditBatchId: order.auditBatchId,
      title: "Order Submitted",
      message: `Vaccine order ${order.orderId} was submitted and is awaiting admin review.`,
      type: "info",
      metadata: {
        status: order.status,
        vaccineType,
        requestedDoses: order.requestedDoses,
      },
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getHospitalOrders = async (req, res) => {
  try {
    const role = normalizeRole(req.user?.role);
    const hospitalName = req.query.hospital || req.query.centerId || "";
    const hospitalFilter =
      role === "admin" || !hospitalName
        ? {}
        : {
            $or: [{ hospital: hospitalName }, { centerId: hospitalName }],
          };

    const [orders, notifications] = await Promise.all([
      Order.find(hospitalFilter).sort({ createdAt: -1 }).lean(),
      Notification.find({
        alertId: { $exists: false }, // Targeted cold-chain records use the identity-scoped alerts API.
        recipientRole: role === "admin" ? "healthcare" : role || "healthcare",
        ...(hospitalName ? { recipientRef: hospitalName } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(15)
        .lean(),
    ]);

    res.json({ orders, notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAdminOrders = async (_req, res) => {
  try {
    const pendingOrders = await Order.find().sort({ createdAt: -1 }).lean();
    res.json({ orders: pendingOrders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.reviewOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { decision, note = "", distributor = "Primary Distributor" } = req.body;

    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const normalizedDecision = String(decision || "").toLowerCase();
    if (!["approve", "decline"].includes(normalizedDecision)) {
      return res.status(400).json({ error: "Decision must be Approve or Decline" });
    }

    order.reviewedAt = new Date();
    order.reviewedBy = req.user?.id || "admin";
    order.adminDecisionNote = note;

    if (normalizedDecision === "approve") {
      const lifecycleReceipt = await logLifecycleEventOnChain({
        batchId: order.auditBatchId,
        actorRole: "Admin",
        action: "Approve Vaccine Order",
        location: order.region || order.hospital,
        details: `Order ${order.orderId} approved`,
        quantity: order.requestedDoses,
      });

      const txHash = extractHash(lifecycleReceipt);
      order.status = "Approved";
      order.blockchainStatus = txHash ? "Approved On-Chain" : "Approved";
      order.approvalTxHash = txHash;
      order.distributorVisible = true;
      await order.save();

      await Shipment.create({
        shipmentId: `SHIP-${order.orderId}`,
        batchId: order.auditBatchId,
        vaccineType: order.vaccineType,
        quantity: order.requestedDoses,
        source: "Admin Allocation Queue",
        distributor,
        destination: order.hospital,
        status: "New Shipment Required",
        txHash,
        statusHistory: [
          {
            status: "New Shipment Required",
            timestamp: new Date(),
            txHash,
          },
        ],
      });

      await createNotification({
        recipientRole: "healthcare",
        recipientRef: order.hospital,
        orderId: order.orderId,
        auditBatchId: order.auditBatchId,
        title: "Order Approved",
        message: `Order ${order.orderId} is approved and moving to distribution.`,
        type: "success",
        metadata: {
          txHash,
          status: order.status,
        },
      });

      await createNotification({
        recipientRole: "distributor",
        recipientRef: distributor,
        orderId: order.orderId,
        auditBatchId: order.auditBatchId,
        title: "New Shipment Required",
        message: `Approved order ${order.orderId} requires shipment to ${order.hospital}.`,
        type: "action",
        metadata: {
          hospital: order.hospital,
          region: order.region,
          vaccineType: order.vaccineType,
          requestedDoses: order.requestedDoses,
          txHash,
        },
      });
    } else {
      order.status = "Declined";
      order.blockchainStatus = "Declined";
      order.distributorVisible = false;
      await order.save();

      await createNotification({
        recipientRole: "healthcare",
        recipientRef: order.hospital,
        orderId: order.orderId,
        auditBatchId: order.auditBatchId,
        title: "Order Declined",
        message: `Order ${order.orderId} was declined. ${note || "Please review admin feedback."}`,
        type: "error",
        metadata: {
          status: order.status,
          note,
        },
      });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDistributorOrders = async (_req, res) => {
  try {
    const [orders, notifications] = await Promise.all([
      Order.find({ status: "Approved", distributorVisible: true }).sort({ reviewedAt: -1 }).lean(),
      Notification.find({ recipientRole: "distributor", alertId: { $exists: false } }).sort({ createdAt: -1 }).limit(15).lean(),
    ]);

    res.json({ orders, notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
