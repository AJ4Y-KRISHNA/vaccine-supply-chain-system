const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
  {
    patientFeedbackText: {
      type: String,
      required: true,
      trim: true,
    },
    feedbackCategory: {
      type: String,
      required: true,
    },
    severity: {
      type: String,
      required: true,
    },
    vaccineBatchId: {
      type: String,
      required: true,
      index: true,
    },
    appointmentId: String,
    patientAgeGroup: String,
    region: String,
    submittedBy: String,
    healthcareCenter: String,
    observationDate: {
      type: Date,
      default: Date.now,
    },
    consentToUseForAnalytics: {
      type: Boolean,
      default: false,
    },
    sentimentScore: {
      type: Number,
      default: 0.5,
    },
    sentimentLabel: {
      type: String,
      default: "Neutral",
    },
    riskFlagContribution: {
      type: Boolean,
      default: false,
    },
    riskReasons: {
      type: [String],
      default: [],
    },
    scoringStatus: {
      type: String,
      default: "Pending",
    },
    decisionSummary: String,
    decisionEngineStatus: {
      type: String,
      default: "Pending",
    },
    source: {
      type: String,
      default: "Healthcare Center",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Feedback", feedbackSchema);
