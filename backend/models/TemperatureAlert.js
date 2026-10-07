const mongoose = require("mongoose");

const TemperatureAlertSchema = new mongoose.Schema(
  {
    alertId: {
      type: String,
      required: true,
      unique: true,
      default: () => `TEMP-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    },
    correlationId: { type: String, maxlength: 128, index: true },
    batchId: { type: String, index: true },
    shipmentId: { type: String, index: true },
    deviceId: { type: String, index: true },
    vehicleId: String,
    manufacturer: String,
    manufacturerKey: { type: String, index: true },
    vaccineType: String,
    temperatureLogId: mongoose.Schema.Types.ObjectId,
    currentTemperature: Number,
    minimumAllowedTemperature: Number,
    maximumAllowedTemperature: Number,
    currentHumidity: Number,
    minimumAllowedHumidity: Number,
    maximumAllowedHumidity: Number,
    metric: { type: String, enum: ["TEMPERATURE", "HUMIDITY", "RELIABILITY", "STATISTICAL_ANOMALY"] },
    breachedLimit: Number,
    currentReading: {
      temperature: Number,
      humidity: Number,
      timestamp: Date,
    },
    violationType: {
      type: String,
      // Keep HUMIDITY for records created by the earlier generic humidity rule.
      enum: ["HIGH_TEMPERATURE", "LOW_TEMPERATURE", "LOW_HUMIDITY", "HIGH_HUMIDITY", "HUMIDITY", "TELEMETRY_RELIABILITY", "STATISTICAL_TREND_ANOMALY"],
      required: true,
    },
    severity: {
      type: String,
      enum: ["WARNING", "CRITICAL"],
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "ACKNOWLEDGED", "RESOLVED"],
      default: "ACTIVE",
      index: true,
    },
    // Response state is separate from event status: the policy engine may close a
    // recovered excursion while a human response still needs to be recorded.
    responseState: {
      type: String,
      enum: ["OPEN", "ACKNOWLEDGED", "ACTION_TAKEN", "RESOLVED"],
      default: "OPEN",
      index: true,
    },
    acknowledgementNote: String,
    actionTaken: { type: String, enum: ["inspect", "reroute", "hold", "discard-review"] },
    actionTakenNote: String,
    actionTakenBy: String,
    actionTakenAt: Date,
    responseResolvedNote: String,
    responseResolvedBy: String,
    responseResolvedAt: Date,
    reason: { type: String, required: true },
    latitude: Number,
    longitude: Number,
    timestamp: { type: Date, required: true, index: true },
    excursionStartedAt: { type: Date, required: true },
    latestReadingAt: { type: Date, required: true },
    maximumExcursionTemperature: Number,
    minimumExcursionTemperature: Number,
    maximumExcursionHumidity: Number,
    minimumExcursionHumidity: Number,
    excursionDurationMs: { type: Number, default: 0 },
    acknowledgedAt: Date,
    acknowledgedBy: String,
    resolvedAt: Date,
    resolvedBy: String,
    resolutionReason: String,
    engineVersion: String,
    policyId: { type: mongoose.Schema.Types.ObjectId, ref: "ColdChainPolicy" },
    policySnapshot: mongoose.Schema.Types.Mixed,
    phase: { type: String, enum: ["REVIEW_REQUIRED", "QUARANTINED", "RECOVERED", "CLEARED", "RELIABILITY_ISSUE"] },
    recommendedAction: String,
    reasons: [String],
    confidence: mongoose.Schema.Types.Mixed,
    context: mongoose.Schema.Types.Mixed,
    notificationTargets: [String],
    excursionClosedAt: Date,
    requiresQualityReview: { type: Boolean, default: false },
    reviewedBy: String,
    reviewedAt: Date,
    reviewReason: String,
    reviewEvidence: String,
    // Present only while an excursion is active. The sparse unique index prevents
    // duplicate active alerts for a device/batch/shipment excursion under retries.
    activeExcursionKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

TemperatureAlertSchema.index({ batchId: 1, deviceId: 1, timestamp: -1 });
TemperatureAlertSchema.index({ shipmentId: 1, timestamp: -1 });

module.exports = mongoose.model("TemperatureAlert", TemperatureAlertSchema);
