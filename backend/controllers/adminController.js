const User = require("../models/user");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Distribution = require("../models/Distribution");
const TemperatureLog = require("../models/TemperatureLog");
const Vaccination = require("../models/Vaccination");
const AdminAction = require("../models/AdminAction");
const ReviewerPermissionAudit = require("../models/ReviewerPermissionAudit");
const { getForecast, getSentiment } = require("../services/aiService");
const { getForecastSupplyContext } = require("../services/forecastSupplyContext");
const { logLifecycleEventOnChain, extractHash } = require("../services/blockchainService");

let reviewerPermissionQueue = Promise.resolve();
function withReviewerPermissionLock(work) {
  const current = reviewerPermissionQueue.catch(() => {}).then(work);
  reviewerPermissionQueue = current.catch(() => {});
  return current;
}

exports.getUserManagement = async (_req, res) => {
  try {
    const users = await User.find().sort({ email: 1 }).lean();
    const adminActions = await AdminAction.find().sort({ createdAt: -1 }).limit(20).lean();

    const formattedUsers = users.map((user) => {
      const recentAction = adminActions.find((action) => {
        const actionDetails = String(action.details || "").toLowerCase();
        const actorRole = String(action.actorRole || "").toLowerCase();
        return (
          actionDetails.includes(String(user.email || "").toLowerCase()) ||
          actorRole === String(user.role || "").toLowerCase()
        );
      });

      return {
        _id: user._id,
        email: user.email,
        role: user.role,
        status: "Active",
        lastActivityAt: recentAction?.createdAt || null,
      };
    });

    res.json({
      total: formattedUsers.length,
      users: formattedUsers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getChainMonitoring = async (_req, res) => {
  try {
    const [batches, shipments, distributions, tempLogs, vaccinations, adminActions] = await Promise.all([
      Batch.find().sort({ createdAt: -1 }).lean(),
      Shipment.find().sort({ lastUpdatedAt: -1 }).lean(),
      Distribution.find().sort({ timestamp: -1 }).lean(),
      TemperatureLog.find().sort({ recordedAt: -1 }).lean(),
      Vaccination.find().sort({ date: -1 }).lean(),
      AdminAction.find().sort({ createdAt: -1 }).lean(),
    ]);

    res.json({
      summary: {
        batches: batches.length,
        shipments: shipments.length,
        distributions: distributions.length,
        vaccinations: vaccinations.length,
        adminActions: adminActions.length,
        blockchainLogs: [...batches, ...shipments, ...distributions, ...vaccinations, ...adminActions].filter((item) => item.txHash).length,
        tempAlerts: tempLogs.filter((item) => item.status === "Alert").length,
      },
      batches: batches.slice(0, 5),
      shipments: shipments.slice(0, 5),
      distributions: distributions.slice(0, 5),
      temperatureLogs: tempLogs.slice(0, 5),
      vaccinations: vaccinations.slice(0, 5),
      adminActions: adminActions.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.runSentimentMonitoring = async (req, res) => {
  try {
    const fallbackText = (await Distribution.find().sort({ timestamp: -1 }).limit(5).lean())
      .map((entry) => entry.socialText)
      .filter(Boolean)
      .join(". ");

    const text = req.body?.text || fallbackText || "Public sentiment data unavailable";
    const sentiment = await getSentiment(text);
    const lifecycleReceipt = await logLifecycleEventOnChain({
      batchId: `ADMIN-${Date.now()}`,
      actorRole: "Admin",
      action: "Sentiment Analysis",
      location: "Admin Dashboard",
      details: sentiment.sentiment || sentiment.label || "Sentiment monitoring completed",
      quantity: 0,
    });
    const txHash = extractHash(lifecycleReceipt);

    await AdminAction.create({
      actionType: "Sentiment Analysis",
      status: "Generated",
      details: sentiment.sentiment || sentiment.label || "Sentiment monitoring completed",
      txHash,
      metadata: {
        text,
        sentiment,
      },
    });

    res.json({
      text,
      sentiment,
      reportStatus: "Generated",
      txHash,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getReportsAndInsights = async (_req, res) => {
  try {
    const vaccinations = await Vaccination.find().sort({ date: -1 }).limit(12).lean();
    const distributions = await Distribution.find().sort({ timestamp: -1 }).limit(6).lean();

    let forecast = { predicted_demand: 0, explanation_breakdown: null };
    const vaccinationHistory = vaccinations.reverse().map((item) => Number(item.dosesUsed || item.receivedDoses || 0));

    if (vaccinationHistory.filter((value) => value > 0).length >= 4) {
      try {
        const vaccineTypes = [...new Set(vaccinations.map(item => String(item.vaccineType || "").trim()).filter(Boolean))];
        let supplyContext = null;
        try {
          supplyContext = await getForecastSupplyContext(vaccineTypes.length === 1 ? vaccineTypes[0] : null);
        } catch (_contextError) {
          // Demand can still be estimated when the optional inventory snapshot is unavailable.
        }
        forecast = await getForecast({ vaccination_data: vaccinationHistory, supply_context: supplyContext });
      } catch (_err) {
        forecast = { predicted_demand: 0, explanation_breakdown: null };
      }
    }

    const insights = distributions.map((entry) => ({
      batchId: entry.batchId,
      forecastDemand: entry.forecastDemand || 0,
      sentimentScore: entry.sentimentScore || 0,
      decision: entry.decision,
      txHash: entry.txHash,
      targetCenter: entry.targetCenter || "National Warehouse",
      timestamp: entry.timestamp,
      riskFlag: Boolean(entry.riskFlag),
    }));

    const reportSeries = vaccinations.map((entry, index) => ({
      label: entry.batchId || `Month ${index + 1}`,
      value: Number(entry.dosesUsed || entry.receivedDoses || 0),
    }));

    res.json({
      forecast,
      insights,
      reportSeries,
      summary: {
        totalInsights: insights.length,
        predictedDemand: Number(forecast.predicted_demand || 0),
        highRiskCount: insights.filter((entry) => entry.riskFlag).length,
        latestTxHash: insights.find((entry) => entry.txHash)?.txHash || "",
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAdminWorkflow = async (_req, res) => {
  try {
    const [users, monitoring, reports, adminActions] = await Promise.all([
      User.find().sort({ email: 1 }).lean(),
      Promise.all([
        Batch.countDocuments(),
        Shipment.countDocuments(),
        Distribution.countDocuments(),
        Vaccination.countDocuments(),
      ]),
      Distribution.find().sort({ timestamp: -1 }).limit(5).lean(),
      AdminAction.find().sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    res.json({
      workflow: [
        { step: "1.1 User Management", status: users.length ? "Configured" : "Pending" },
        { step: "1.2 Vaccine Chain Monitoring", status: monitoring.some((count) => count > 0) ? "Active" : "Pending" },
        { step: "1.3 Reports & Insights", status: reports.length ? "Generated" : "Pending" },
        { step: "1.4 Sentiment Analysis", status: adminActions.length ? "Active" : "Pending" },
      ],
      counts: {
        users: users.length,
        batches: monitoring[0],
        shipments: monitoring[1],
        distributions: monitoring[2],
        vaccinations: monitoring[3],
        adminActions: adminActions.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getColdChainReviewers = async (_req, res) => {
  try {
    const [users, audit] = await Promise.all([
      User.find({ role: { $in: ["admin", "manufacturer"] } }).select("email role manufacturer canReviewColdChain disabled").sort({ email: 1 }).lean(),
      ReviewerPermissionAudit.find().sort({ eventTime: -1 }).limit(100).lean(),
    ]);
    return res.json({ reviewers: users.map(user => ({ userId: String(user._id), email: user.email, role: user.role,
      organization: user.manufacturer || "", canReviewColdChain: user.canReviewColdChain === true, disabled: Boolean(user.disabled) })), audit });
  } catch (_) { return res.status(503).json({ error: "Reviewer permissions are unavailable" }); }
};

exports.setColdChainReviewer = async (req, res) => {
  const Joi = require("joi");
  const { error, value } = Joi.object({ canReviewColdChain: Joi.boolean().strict().required(), reason: Joi.string().trim().min(3).max(1000).required() }).validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({ error: error.message });
  if (!require("mongoose").isValidObjectId(req.params.userId)) return res.status(400).json({ error: "Invalid user id" });
  return withReviewerPermissionLock(async () => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user || !["admin", "manufacturer"].includes(user.role)) return res.status(404).json({ error: "Eligible reviewer account not found" });
    if (value.canReviewColdChain && user.disabled) return res.status(409).json({ error: "Disabled accounts cannot be designated as reviewers" });
    const previousPermission = user.canReviewColdChain === true;
    if (previousPermission === value.canReviewColdChain) return res.json({ reviewer: { userId: String(user._id), email: user.email, role: user.role, canReviewColdChain: previousPermission }, unchanged: true });
    if (!value.canReviewColdChain && previousPermission && !user.disabled) {
      const activeReviewers = await User.countDocuments({ role: { $in: ["admin", "manufacturer"] }, canReviewColdChain: true, disabled: { $ne: true } });
      if (activeReviewers <= 1) return res.status(409).json({ error: "At least one active cold-chain reviewer must remain designated" });
    }
    const now = new Date();
    const action = value.canReviewColdChain ? "GRANT" : "REVOKE";
    const Audit = ReviewerPermissionAudit;
    await Audit.create({ targetUserId: String(user._id), targetEmail: user.email, actorId: req.user.id,
      action: `${action}_REQUESTED`, previousPermission, requestedPermission: value.canReviewColdChain, reason: value.reason, eventTime: now });
    user.canReviewColdChain = value.canReviewColdChain;
    await user.save();
    await Audit.create({ targetUserId: String(user._id), targetEmail: user.email, actorId: req.user.id,
      action: `${action}_APPLIED`, previousPermission, requestedPermission: value.canReviewColdChain, reason: value.reason, eventTime: new Date() });
    return res.json({ reviewer: { userId: String(user._id), email: user.email, role: user.role, canReviewColdChain: value.canReviewColdChain } });
  } catch (_) { return res.status(503).json({ error: "Reviewer permission change could not be completed; refresh permissions before retrying" }); }
  });
};
