const { getSentiment, getFeedbackDecision } = require("../services/aiService");
const {
  createFeedbackRecord,
  listFeedbackRecords,
  ensureFeedbackSeedData,
} = require("../services/feedbackStore");

const allowedCategories = [
  "Side Effects",
  "Effectiveness",
  "Storage Concern",
  "Administration Issue",
  "Other",
];

const allowedSeverity = ["Low", "Medium", "High"];
const allowedAgeGroups = ["Child", "Adult", "Senior"];

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function scoreLabel(value) {
  if (value < 0.4) return "Negative";
  if (value < 0.7) return "Neutral";
  return "Positive";
}

function buildValidationErrors(body = {}) {
  const errors = {};
  const feedbackText = normalizeText(body.patientFeedbackText);
  const category = String(body.feedbackCategory || "");
  const severity = String(body.severity || "");
  const batchId = normalizeText(body.vaccineBatchId);

  if (!feedbackText) {
    errors.patientFeedbackText = "Feedback text is required.";
  } else if (feedbackText.length < 10) {
    errors.patientFeedbackText = "Feedback must be at least 10 characters.";
  }

  if (!allowedCategories.includes(category)) {
    errors.feedbackCategory = "Please select a valid feedback category.";
  }

  if (!allowedSeverity.includes(severity)) {
    errors.severity = "Please select a valid severity.";
  }

  if (!batchId) {
    errors.vaccineBatchId = "Vaccine batch ID is required.";
  }

  if (body.patientAgeGroup && !allowedAgeGroups.includes(String(body.patientAgeGroup))) {
    errors.patientAgeGroup = "Please select a valid age group.";
  }

  return errors;
}

function buildRiskHighlights(records) {
  const highlights = [];
  const regionBuckets = new Map();
  const batchBuckets = new Map();

  records.forEach((entry) => {
    const regionKey = entry.region || "Unknown Region";
    const batchKey = entry.vaccineBatchId || "Unknown Batch";
    const regionBucket = regionBuckets.get(regionKey) || {
      region: regionKey,
      negativeCount: 0,
      total: 0,
    };
    regionBucket.total += 1;
    if (entry.sentimentLabel === "Negative") regionBucket.negativeCount += 1;
    regionBuckets.set(regionKey, regionBucket);

    const batchBucket = batchBuckets.get(batchKey) || {
      vaccineBatchId: batchKey,
      total: 0,
      highSeverityCount: 0,
      flaggedCount: 0,
    };
    batchBucket.total += 1;
    if (entry.severity === "High") batchBucket.highSeverityCount += 1;
    if (entry.riskFlagContribution) batchBucket.flaggedCount += 1;
    batchBuckets.set(batchKey, batchBucket);
  });

  regionBuckets.forEach((bucket) => {
    if (bucket.negativeCount >= 2) {
      highlights.push({
        type: "region",
        region: bucket.region,
        reason: `High number of negative feedback entries in ${bucket.region}`,
      });
    }
  });

  batchBuckets.forEach((bucket) => {
    if (bucket.highSeverityCount >= 2 || bucket.flaggedCount >= 2) {
      highlights.push({
        type: "batch",
        vaccineBatchId: bucket.vaccineBatchId,
        reason: `Multiple high-severity reports for Batch ${bucket.vaccineBatchId}`,
      });
    }
  });

  if (!highlights.length) {
    const flagged = records.find((entry) => entry.riskFlagContribution);
    if (flagged) {
      highlights.push({
        type: "feedback",
        vaccineBatchId: flagged.vaccineBatchId,
        region: flagged.region,
        reason: flagged.riskReasons?.join(" | ") || "Risk feedback requires monitoring",
      });
    }
  }

  return highlights;
}

function buildAdminPayload(records) {
  const sorted = [...records].sort(
    (a, b) => new Date(b.observationDate || b.createdAt) - new Date(a.observationDate || a.createdAt)
  );

  const totalFeedbackCount = sorted.length;
  const positiveCount = sorted.filter((item) => item.sentimentLabel === "Positive").length;
  const neutralCount = sorted.filter((item) => item.sentimentLabel === "Neutral").length;
  const negativeCount = sorted.filter((item) => item.sentimentLabel === "Negative").length;
  const flagged = sorted.filter((item) => item.riskFlagContribution);

  const regionSummary = Object.values(
    sorted.reduce((acc, item) => {
      const key = item.region || "Unknown Region";
      if (!acc[key]) {
        acc[key] = {
          region: key,
          total: 0,
          flaggedCount: 0,
          negativeCount: 0,
        };
      }
      acc[key].total += 1;
      if (item.riskFlagContribution) acc[key].flaggedCount += 1;
      if (item.sentimentLabel === "Negative") acc[key].negativeCount += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.flaggedCount - a.flaggedCount || b.total - a.total);

  const batchSummary = Object.values(
    sorted.reduce((acc, item) => {
      const key = item.vaccineBatchId || "Unknown Batch";
      if (!acc[key]) {
        acc[key] = {
          vaccineBatchId: key,
          total: 0,
          flaggedCount: 0,
          highSeverityCount: 0,
          negativeCount: 0,
        };
      }
      acc[key].total += 1;
      if (item.riskFlagContribution) acc[key].flaggedCount += 1;
      if (item.severity === "High") acc[key].highSeverityCount += 1;
      if (item.sentimentLabel === "Negative") acc[key].negativeCount += 1;
      return acc;
    }, {})
  ).sort((a, b) => b.flaggedCount - a.flaggedCount || b.total - a.total);

  return {
    summary: {
      totalFeedbackCount,
      positiveCount,
      neutralCount,
      negativeCount,
      flaggedCount: flagged.length,
    },
    recentFeedback: sorted.slice(0, 8),
    flaggedFeedback: flagged.slice(0, 8),
    regionSummary,
    batchSummary,
    riskHighlights: buildRiskHighlights(sorted),
    records: sorted,
  };
}

async function buildFeedbackRecord(body, req) {
  const patientFeedbackText = normalizeText(body.patientFeedbackText);
  const region = normalizeText(body.region) || "Unknown Region";
  const submittedBy =
    req.user?.email ||
    (req.user?.id ? `user-${req.user.id}` : "healthcare-operator");
  const observationDate = body.observationDate ? new Date(body.observationDate) : new Date();

  const sentiment = await getSentiment(patientFeedbackText);
  const sentimentScore = normalizeScore(sentiment.score);
  const sentimentLabel = sentiment.sentiment || scoreLabel(sentimentScore);
  const scoringStatus = sentiment.scoringStatus || "AI Model";

  const decision = await getFeedbackDecision({
    patientFeedbackText,
    feedbackCategory: body.feedbackCategory,
    severity: body.severity,
    vaccineBatchId: normalizeText(body.vaccineBatchId),
    appointmentId: normalizeText(body.appointmentId),
    patientAgeGroup: body.patientAgeGroup,
    region,
    submittedBy,
    sentimentScore,
    sentimentLabel,
    scoringStatus,
  });

  return {
    patientFeedbackText,
    feedbackCategory: body.feedbackCategory,
    severity: body.severity,
    vaccineBatchId: normalizeText(body.vaccineBatchId),
    appointmentId: normalizeText(body.appointmentId),
    patientAgeGroup: body.patientAgeGroup || "",
    region,
    submittedBy,
    healthcareCenter: normalizeText(body.healthcareCenter) || normalizeText(body.centerId) || "Healthcare Center",
    observationDate,
    consentToUseForAnalytics: Boolean(body.consentToUseForAnalytics),
    sentimentScore,
    sentimentLabel,
    riskFlagContribution: Boolean(decision.riskFlagContribution),
    riskReasons: decision.riskReasons || [],
    scoringStatus: decision.scoringStatus || scoringStatus,
    decisionSummary: decision.decisionSummary || "Feedback processed",
    decisionEngineStatus: decision.decisionEngineStatus || "Processed",
    source: "Healthcare Center",
  };
}

exports.submitFeedback = async (req, res) => {
  try {
    const errors = buildValidationErrors(req.body);
    if (Object.keys(errors).length) {
      return res.status(400).json({ errors });
    }

    const feedback = await buildFeedbackRecord(req.body, req);
    const created = await createFeedbackRecord(feedback);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message || "Unable to submit feedback" });
  }
};

exports.getHealthcareFeedback = async (req, res) => {
  try {
    await ensureFeedbackSeedData();
    const submittedBy = req.query.submittedBy ? normalizeText(req.query.submittedBy) : "";
    const healthcareCenter = req.query.healthcareCenter ? normalizeText(req.query.healthcareCenter) : "";
    const region = req.query.region ? normalizeText(req.query.region) : "";

    let records = await listFeedbackRecords({
      ...(submittedBy ? { submittedBy } : {}),
      ...(healthcareCenter ? { healthcareCenter } : {}),
      ...(region ? { region } : {}),
    });
    if (req.user.role !== "admin") records = records.filter(record =>
      record.submittedBy === req.user.email || require("../middleware/identityScope").ownsIdentity(req.user, record.healthcareCenter));

    res.json({
      count: records.length,
      records: records.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unable to load healthcare feedback" });
  }
};

exports.getAdminFeedback = async (_req, res) => {
  try {
    await ensureFeedbackSeedData();
    const records = await listFeedbackRecords();
    res.json(buildAdminPayload(records));
  } catch (err) {
    res.status(500).json({ error: err.message || "Unable to load admin feedback" });
  }
};
