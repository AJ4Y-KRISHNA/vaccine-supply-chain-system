const axios = require("axios");

const AI_BASE_URL = process.env.AI_BASE_URL || "http://127.0.0.1:8000";
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60000);

function clampScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.max(0, Math.min(1, parsed));
}

function labelFromScore(score) {
  if (score < 0.4) return "Negative";
  if (score < 0.7) return "Neutral";
  return "Positive";
}

function mockSentiment(text) {
  const normalized = String(text || "").trim().toLowerCase();
  const positiveHints = [
    "effective",
    "smooth",
    "good",
    "safe",
    "helpful",
    "stable",
    "improved",
    "protected",
    "successful",
    "satisfied",
  ];
  const negativeHints = [
    "side effect",
    "ineffective",
    "delay",
    "storage concern",
    "warm",
    "issue",
    "pain",
    "bad",
    "worry",
    "problem",
    "reaction",
    "unsafe",
    "complaint",
  ];

  let score = 0.55;
  negativeHints.forEach((keyword) => {
    if (normalized.includes(keyword)) score -= 0.12;
  });
  positiveHints.forEach((keyword) => {
    if (normalized.includes(keyword)) score += 0.1;
  });

  score = clampScore(score);
  return {
    sentiment: labelFromScore(score),
    score,
    scoringStatus: "Mocked Fallback",
  };
}

function mockFeedbackDecision(payload = {}) {
  const severity = String(payload.severity || "Low");
  const sentimentScore = clampScore(payload.sentimentScore ?? mockSentiment(payload.patientFeedbackText).score);
  const sentimentLabel = payload.sentimentLabel || labelFromScore(sentimentScore);
  const reasons = [];

  if (sentimentLabel === "Negative") {
    reasons.push("Negative sentiment feedback detected");
  }
  if (severity === "High") {
    reasons.push("High severity feedback reported");
  }
  if (
    String(payload.feedbackCategory || "").toLowerCase().includes("storage")
  ) {
    reasons.push("Storage concern category requires immediate review");
  }

  const riskFlagContribution = reasons.length > 0;

  return {
    riskFlagContribution,
    riskReasons: reasons,
    scoringStatus: payload.scoringStatus || "Mocked Fallback",
    decisionSummary: riskFlagContribution
      ? `Feedback flagged for review in ${payload.region || "the selected region"}`
      : "Feedback logged without elevated risk",
    decisionEngineStatus: "Processed",
  };
}

exports.getDistributionDecision = async (data) => {
  const url = `${AI_BASE_URL}/decision/decide`;
  try {
    const response = await axios.post(url, data, { timeout: AI_TIMEOUT_MS });

    console.log("✅ AI RESPONSE:", response.data);

    return response.data;
  } catch (error) {
    console.error("❌ AI ERROR:", error.message);
    if (error.response?.data) {
      console.error(error.response.data);
    }
    throw new Error(`AI decision service failed: ${error.message}`);
  }
};

exports.getForecast = async (data) => {
  const url = `${AI_BASE_URL}/forecast/forecast`;
  try {
    const response = await axios.post(url, data || {}, { timeout: AI_TIMEOUT_MS });
    return response.data;
  } catch (error) {
    throw new Error(`AI forecast service failed: ${error.message}`);
  }
};

exports.getSentiment = async (text) => {
  const url = `${AI_BASE_URL}/sentiment/sentiment`;
  try {
    const response = await axios.post(url, { text }, { timeout: AI_TIMEOUT_MS });
    return {
      sentiment: response.data.sentiment || response.data.sentimentLabel || "Neutral",
      score: clampScore(response.data.score ?? response.data.sentimentScore),
      scoringStatus: response.data.scoringStatus || "AI Model",
      rawLabel: response.data.raw_label || response.data.rawLabel || response.data.sentiment,
    };
  } catch (error) {
    return mockSentiment(text);
  }
};

exports.getFeedbackDecision = async (payload) => {
  const url = `${AI_BASE_URL}/decision/feedback-risk`;
  try {
    const response = await axios.post(url, payload, { timeout: AI_TIMEOUT_MS });
    return response.data;
  } catch (error) {
    return mockFeedbackDecision(payload);
  }
};
