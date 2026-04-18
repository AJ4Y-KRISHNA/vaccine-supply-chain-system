const mongoose = require("mongoose");
const Feedback = require("../models/Feedback");

const demoSeedRecords = [
  {
    patientFeedbackText: "The vaccination process was smooth, and I felt protected within a few days.",
    feedbackCategory: "Effectiveness",
    severity: "Low",
    vaccineBatchId: "BATCH-FDBK-001",
    appointmentId: "APT-1001",
    patientAgeGroup: "Adult",
    region: "Region A",
    submittedBy: "nurse.regiona@demo.local",
    healthcareCenter: "City Hospital",
    observationDate: new Date(Date.now() - 1000 * 60 * 60 * 20),
    consentToUseForAnalytics: true,
    sentimentScore: 0.88,
    sentimentLabel: "Positive",
    riskFlagContribution: false,
    riskReasons: [],
    scoringStatus: "Demo Seeded",
    decisionSummary: "Positive feedback kept the regional risk profile stable.",
    decisionEngineStatus: "Processed",
    source: "Healthcare Center",
  },
  {
    patientFeedbackText: "The patient reported mild discomfort, but nothing severe after observation.",
    feedbackCategory: "Administration Issue",
    severity: "Medium",
    vaccineBatchId: "BATCH-FDBK-002",
    appointmentId: "APT-1002",
    patientAgeGroup: "Senior",
    region: "Region B",
    submittedBy: "clinic.regionb@demo.local",
    healthcareCenter: "District Clinic",
    observationDate: new Date(Date.now() - 1000 * 60 * 60 * 15),
    consentToUseForAnalytics: true,
    sentimentScore: 0.56,
    sentimentLabel: "Neutral",
    riskFlagContribution: false,
    riskReasons: [],
    scoringStatus: "Demo Seeded",
    decisionSummary: "Neutral operational feedback does not raise risk on its own.",
    decisionEngineStatus: "Processed",
    source: "Healthcare Center",
  },
  {
    patientFeedbackText: "Several patients complained that the vaccine seemed ineffective and caused worrying reactions.",
    feedbackCategory: "Side Effects",
    severity: "Medium",
    vaccineBatchId: "BATCH-FDBK-003",
    appointmentId: "APT-1003",
    patientAgeGroup: "Adult",
    region: "Region A",
    submittedBy: "observer.regiona@demo.local",
    healthcareCenter: "Metro Vaccination Center",
    observationDate: new Date(Date.now() - 1000 * 60 * 60 * 10),
    consentToUseForAnalytics: true,
    sentimentScore: 0.22,
    sentimentLabel: "Negative",
    riskFlagContribution: true,
    riskReasons: ["Negative sentiment feedback detected"],
    scoringStatus: "Demo Seeded",
    decisionSummary: "Negative feedback increases monitoring priority for this batch.",
    decisionEngineStatus: "Processed",
    source: "Healthcare Center",
  },
  {
    patientFeedbackText: "Storage concern reported after the shipment arrived warm and patients were worried.",
    feedbackCategory: "Storage Concern",
    severity: "High",
    vaccineBatchId: "BATCH-FDBK-003",
    appointmentId: "APT-1004",
    patientAgeGroup: "Child",
    region: "Region A",
    submittedBy: "coldchain.regiona@demo.local",
    healthcareCenter: "Metro Vaccination Center",
    observationDate: new Date(Date.now() - 1000 * 60 * 60 * 5),
    consentToUseForAnalytics: true,
    sentimentScore: 0.38,
    sentimentLabel: "Negative",
    riskFlagContribution: true,
    riskReasons: ["High severity feedback reported", "Negative sentiment feedback detected"],
    scoringStatus: "Demo Seeded",
    decisionSummary: "Multiple high-severity reports for Batch BATCH-FDBK-003 require investigation.",
    decisionEngineStatus: "Processed",
    source: "Healthcare Center",
  },
];

let memoryFeedback = [];

function isDbReady() {
  return mongoose.connection.readyState === 1;
}

function cloneMemoryRecords() {
  return memoryFeedback
    .map((item) => ({ ...item }))
    .sort((a, b) => new Date(b.observationDate || b.createdAt) - new Date(a.observationDate || a.createdAt));
}

function normalizeSeedRecord(entry, index) {
  const now = Date.now() - index * 1000 * 60;
  return {
    ...entry,
    _id: entry._id || `feedback-seed-${index + 1}`,
    createdAt: entry.createdAt || new Date(now),
    updatedAt: entry.updatedAt || new Date(now),
  };
}

async function ensureFeedbackSeedData() {
  if (isDbReady()) {
    const count = await Feedback.countDocuments();
    if (!count) {
      await Feedback.insertMany(demoSeedRecords);
    }
    return;
  }

  if (!memoryFeedback.length) {
    memoryFeedback = demoSeedRecords.map(normalizeSeedRecord);
  }
}

function matchesFilter(entry, filter = {}) {
  return Object.entries(filter).every(([key, value]) => {
    if (value == null || value === "") return true;
    return String(entry[key] || "") === String(value);
  });
}

async function createFeedbackRecord(payload) {
  await ensureFeedbackSeedData();

  if (isDbReady()) {
    const record = await Feedback.create(payload);
    return record.toObject();
  }

  const createdAt = new Date();
  const record = {
    _id: `feedback-${Date.now()}`,
    ...payload,
    createdAt,
    updatedAt: createdAt,
  };
  memoryFeedback.unshift(record);
  return { ...record };
}

async function listFeedbackRecords(filter = {}) {
  await ensureFeedbackSeedData();

  if (isDbReady()) {
    return Feedback.find(filter).sort({ observationDate: -1, createdAt: -1 }).lean();
  }

  return cloneMemoryRecords().filter((entry) => matchesFilter(entry, filter));
}

module.exports = {
  ensureFeedbackSeedData,
  createFeedbackRecord,
  listFeedbackRecords,
};
