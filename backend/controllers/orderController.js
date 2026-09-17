const Order = require("../models/Order");
const Notification = require("../models/Notification");
const User = require("../models/user");
const { randomUUID } = require("crypto");
const { inventorySnapshot, isDoseCount } = require("../services/inventoryEligibility");
const allocationService = require("../services/orderAllocationService");
const Vaccination = require("../models/Vaccination");
const { getForecast, getSentiment } = require("../services/aiService");

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
    if (!isDoseCount(requestedDoses) || requestedDoses === 0) return res.status(400).json({ error: "Requested doses must be a positive whole number" });
    const orderId = `ORD-${randomUUID()}`;
    const auditBatchId = buildAuditBatchId(orderId);

    const availableStock = (await inventorySnapshot())
      .filter(batch => batch.vaccineType === vaccineType && batch.eligible)
      .reduce((sum, batch) => sum + batch.remainingDoses, 0);

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
      Order.find({ $and: [req.scope.order, hospitalFilter] }).sort({ createdAt: -1 }).lean(),
      Notification.find({
        alertId: { $exists: false }, // Targeted cold-chain records use the identity-scoped alerts API.
        recipientRole: role === "admin" ? "healthcare" : role || "healthcare",
        ...(hospitalName ? { recipientRef: hospitalName } : {}),
        ...(role === "admin" ? {} : { recipientRef: { $in: require("../middleware/identityScope").identityPatterns(req.user) } }),
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
    const [pendingOrders, allocationOptions, users] = await Promise.all([
      Order.find().sort({ createdAt: -1 }).lean(), inventorySnapshot(),
      User.find({ role: "distributor" }).select("email distributor").lean(),
    ]);
    res.json({ orders: pendingOrders, allocationOptions,
      distributors: [...new Set(users.map(user => user.distributor || user.email).filter(Boolean))] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.reviewOrder = async (req, res) => {
  try {
    const order = await allocationService.reviewOrder({ ...req.body, orderId: req.params.orderId, actorId: req.user.id });
    res.json(order);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
};

exports.getDistributorOrders = async (_req, res) => {
  try {
    const [orders, notifications] = await Promise.all([
      Order.find({ $and: [_req.scope.order, { status: "Approved", distributorVisible: true }] }).sort({ reviewedAt: -1 }).lean(),
      Notification.find({ recipientRole: "distributor", alertId: { $exists: false },
        ...(_req.user.role === "admin" ? {} : { recipientRef: { $in: require("../middleware/identityScope").identityPatterns(_req.user) } }) }).sort({ createdAt: -1 }).limit(15).lean(),
    ]);

    res.json({ orders, notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
