const mongoose = require("mongoose");
const Joi = require("joi");
const Alert = require("../models/TemperatureAlert");
const Notification = require("../models/Notification");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Policy = require("../models/ColdChainPolicy");
const Audit = require("../models/ColdChainAudit");
const State = require("../models/TelemetryState");
const { withBatchLock } = require("../services/coldChainLock");
const { audit, notify, quarantine, normaliseKey } = require("../services/coldChainActions");
const { checkMissingTelemetry } = require("../services/temperatureAlertService");

const policySchema = Joi.object({
  minimumTemperature: Joi.number().required(),
  maximumTemperature: Joi.number().greater(Joi.ref("minimumTemperature")).required(),
  minimumHumidity: Joi.number().min(0).max(100),
  maximumHumidity: Joi.number().min(0).max(100).greater(Joi.ref("minimumHumidity")),
  excursionDurationMs: Joi.number().integer().min(1).required(),
  maximumReadingGapMs: Joi.number().integer().min(1).required(),
  criticalBatteryPercent: Joi.number().min(0).max(100).required(),
  maximumRateCelsiusPerMinute: Joi.number().positive().required(),
  sourceReference: Joi.string().trim().min(3).max(2000).required(),
  approvalReason: Joi.string().trim().min(3).max(2000).required(),
}).and("minimumHumidity", "maximumHumidity");
const reasonSchema = Joi.object({ reason: Joi.string().trim().min(3).max(2000).required(), asOf: Joi.string().isoDate() });
const isOperator = req => ["admin", "manufacturer"].includes(req.user.role);
const isReviewer = req => isOperator(req) && req.user.canReviewColdChain === true;
const keysFor = req => [...new Set([req.user.email, req.user[req.user.role === "healthcare" ? "hospital" : req.user.role]].map(normaliseKey).filter(Boolean))];
function notificationFilter(req) {
  if (!["admin", "manufacturer", "distributor", "healthcare"].includes(req.user.role)) return null;
  return { recipientRole: req.user.role, alertId: { $exists: true },
    ...(req.user.role === "admin" ? {} : { recipientRefKey: { $in: keysFor(req) } }) };
}
async function alertVisibilityFilter(req) {
  if (req.user.role === "admin") return {};
  if (req.user.role === "manufacturer") return { manufacturerKey: { $in: keysFor(req) } };
  const filter = notificationFilter(req);
  return filter ? { alertId: { $in: await Notification.distinct("alertId", filter) } } : null;
}
function canAccessBatch(req, batch) {
  return req.user.role === "admin" || req.user.role === "manufacturer" && keysFor(req).includes(normaliseKey(batch.manufacturer));
}
const handler = fn => async (req, res) => {
  try { return await fn(req, res); } catch (error) { return res.status(500).json({ error: error.message }); }
};
const denied = res => res.status(403).json({ error: "This account is not authorized for this cold-chain action" });
const notFound = res => res.status(404).json({ error: "Alert or batch not found" });
async function visibleAlert(req) {
  const visibility = await alertVisibilityFilter(req);
  return visibility && Alert.findOne({ $and: [visibility, { alertId: req.params.alertId }] });
}

exports.getAlerts = handler(async (req, res) => {
  const visibility = await alertVisibilityFilter(req);
  if (!visibility) return denied(res);
  const filter = {};
  for (const key of ["status", "severity", "batchId", "shipmentId", "deviceId", "phase"]) if (req.query[key]) filter[key] = String(req.query[key]);
  for (const [key, operator] of [["from", "$gte"], ["to", "$lte"]]) {
    if (!req.query[key]) continue;
    const date = new Date(req.query[key]);
    if (!Number.isFinite(date.getTime())) return res.status(400).json({ error: "Invalid date filter" });
    if (key === "to" && /^\d{4}-\d{2}-\d{2}$/.test(req.query[key])) date.setUTCHours(23, 59, 59, 999);
    filter.timestamp = { ...filter.timestamp, [operator]: date };
  }
  const query = { $and: [visibility, filter] };
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const [alerts, total] = await Promise.all([Alert.find(query).sort({ timestamp: -1 }).limit(limit).lean(), Alert.countDocuments(query)]);
  return res.json({ alerts, total });
});
exports.getAlertSummary = handler(async (req, res) => {
  const visibility = await alertVisibilityFilter(req);
  if (!visibility) return denied(res);
  const count = filter => Alert.countDocuments({ $and: [visibility, filter] });
  const active = { status: { $in: ["ACTIVE", "ACKNOWLEDGED"] } };
  const [total, activeCount, critical, warning, resolved, recent] = await Promise.all([
    count({}), count(active), count({ ...active, severity: "CRITICAL" }), count({ ...active, severity: "WARNING" }),
    count({ status: "RESOLVED" }), Alert.find(visibility).sort({ timestamp: -1 }).limit(8).lean(),
  ]);
  return res.json({ total, active: activeCount, critical, warning, resolved, recent,
    permissions: { canManage: isOperator(req), canReview: isReviewer(req) } });
});
exports.getAlertById = handler(async (req, res) => {
  const alert = await visibleAlert(req);
  if (!alert) return notFound(res);
  const auditTrail = await Audit.find({ alertId: alert.alertId }).sort({ recordedAt: 1 }).lean();
  const states = await State.find({ batchId: alert.batchId }).lean();
  const latestClock = states.reduce((last, state) => Math.max(last, +state.lastReadingAt, +state.checkedAt || 0), 0);
  return res.json({ alert, auditTrail, evidenceAsOf: latestClock ? new Date(latestClock).toISOString() : null });
});

// All human actions and evaluations for a batch share a queue in this single-process prototype.
function action(kind) {
  return handler(async (req, res) => {
    if (!isOperator(req) || ["REVIEW", "CLEAR"].includes(kind) && !isReviewer(req)) return denied(res);
    const input = kind === "ACKNOWLEDGE" ? { value: { reason: "Alert acknowledged" } } : reasonSchema.validate(req.body);
    if (input.error) return res.status(400).json({ error: input.error.message });
    const found = await visibleAlert(req);
    if (!found) return notFound(res);
    return withBatchLock(found.batchId, async () => {
      const alert = await Alert.findById(found._id);
      const { reason, asOf } = input.value;
      if (kind === "ACKNOWLEDGE") {
        if (alert.status === "RESOLVED") return res.status(409).json({ error: "Resolved alerts cannot be acknowledged" });
        await audit(alert, kind, req.user.id, reason, alert.latestReadingAt);
        alert.status = "ACKNOWLEDGED"; alert.acknowledgedAt = new Date(); alert.acknowledgedBy = req.user.id;
        await alert.save();
      } else if (kind === "QUARANTINE") {
        if (alert.phase === "CLEARED") return res.status(409).json({ error: "Cleared events cannot be reopened; use the current event" });
        await quarantine(alert, req.user.id, reason, alert.latestReadingAt);
      } else {
        // Explicit simulation time avoids comparing seeded historical telemetry to the wall clock.
        if (!asOf) return res.status(400).json({ error: "asOf (current simulation clock) is required for review/clear" });
        const batch = await Batch.findOne({ batchId: alert.batchId }).lean();
        const policy = batch?.coldChainPolicyId && await Policy.findById(batch.coldChainPolicyId).lean();
        const states = await State.find({ batchId: alert.batchId }).sort({ streamKey: 1 }).lean();
        const clock = new Date(asOf);
        const openEvent = await Alert.exists({ batchId: alert.batchId, activeExcursionKey: { $exists: true } });
        const unreliable = !policy || !states.length || states.some(state =>
          String(state.policyId) !== String(policy._id) || !state.lastReadingAt || clock < state.lastReadingAt || clock < state.checkedAt ||
          clock - state.lastReadingAt > policy.maximumReadingGapMs || state.temperatureDirection !== "NORMAL");
        if (openEvent || unreliable || !alert.excursionClosedAt) return res.status(409).json({ error: "All batch streams need fresh, reliable, in-policy readings and closed excursions before quality review/clearance" });
        const evidence = JSON.stringify(states.map(s => [s.streamKey, s.lastReadingAt, s.checkedAt, s.policyId]));
        if (kind === "REVIEW") {
          await audit(alert, "QUALITY_REVIEW", req.user.id, reason, clock, { evidence });
          alert.reviewedBy = req.user.id; alert.reviewedAt = new Date(); alert.reviewReason = reason; alert.reviewEvidence = evidence;
          await alert.save();
        } else {
          if (alert.phase === "CLEARED") return res.json({ alert });
          if (!alert.reviewedBy || alert.reviewEvidence !== evidence) return res.status(409).json({ error: "Record a quality review of the current readings before clearing" });
          // Durable authorization precedes releasing any holds. Operations also check requiresQualityReview.
          await audit(alert, "CLEAR_AUTHORIZED", req.user.id, reason, clock, { evidence, reviewedBy: alert.reviewedBy });
          await Batch.updateOne({ batchId: alert.batchId }, { $pull: { coldChainHoldAlertIds: alert.alertId } });
          await Shipment.updateMany({ batchId: alert.batchId }, { $pull: { coldChainHoldAlertIds: alert.alertId } });
          await Batch.updateOne({ batchId: alert.batchId, "coldChainHoldAlertIds.0": { $exists: false } }, { $unset: { coldChainStatus: 1 } });
          await Shipment.updateMany({ batchId: alert.batchId, "coldChainHoldAlertIds.0": { $exists: false } }, { $unset: { coldChainStatus: 1 } });
          alert.requiresQualityReview = false; alert.phase = "CLEARED"; alert.status = "RESOLVED";
          alert.resolvedAt = new Date(); alert.resolvedBy = req.user.id; alert.resolutionReason = reason;
          const otherHold = await Alert.exists({ batchId: alert.batchId, alertId: { $ne: alert.alertId }, requiresQualityReview: true });
          alert.recommendedAction = otherHold ? "This event is cleared; other batch holds still block operations." : "Cold-chain hold cleared; existing workflow eligibility rules still apply.";
          await alert.save();
          await audit(alert, "CLEARED", req.user.id, reason, clock);
          await notify(alert, "CLEARED");
        }
      }
      return res.json({ alert });
    });
  });
}
exports.acknowledgeAlert = action("ACKNOWLEDGE");
exports.quarantineAlert = action("QUARANTINE");
exports.reviewAlert = action("REVIEW");
exports.clearAlert = action("CLEAR");
// Retain the URL, but never let legacy Resolve bypass quality clearance.
exports.resolveAlert = exports.clearAlert;
exports.getNotifications = handler(async (req, res) => {
  const filter = notificationFilter(req);
  if (!filter) return denied(res);
  return res.json({ notifications: await Notification.find(filter).sort({ createdAt: -1 }).limit(50).lean() });
});
exports.markNotificationRead = handler(async (req, res) => {
  const filter = notificationFilter(req);
  if (!filter) return denied(res);
  if (!mongoose.isValidObjectId(req.params.notificationId)) return res.status(400).json({ error: "Invalid notification id" });
  const notification = await Notification.findOneAndUpdate({ ...filter, _id: req.params.notificationId }, { $set: { read: true } }, { new: true });
  return notification ? res.json({ notification }) : notFound(res);
});
exports.getBatchTemperaturePolicy = handler(async (req, res) => {
  const batch = await Batch.findOne({ batchId: req.params.batchId }).lean();
  if (!batch) return notFound(res);
  if (!canAccessBatch(req, batch)) return denied(res);
  const policy = batch.coldChainPolicyId ? await Policy.findById(batch.coldChainPolicyId).lean() : null;
  return res.json({ batchId: batch.batchId, temperaturePolicy: batch.temperaturePolicy || null, policy, policyStatus: policy ? "APPROVED" : "POLICY_NOT_APPROVED" });
});
exports.approveBatchPolicy = handler(async (req, res) => {
  if (!isReviewer(req)) return denied(res);
  const { error, value } = policySchema.validate(req.body, { abortEarly: false });
  if (error) return res.status(400).json({ error: error.message });
  return withBatchLock(req.params.batchId, async () => {
    const batch = await Batch.findOne({ batchId: req.params.batchId });
    if (!batch) return notFound(res);
    if (!canAccessBatch(req, batch)) return denied(res);
    if (batch.coldChainHoldAlertIds?.length || await Alert.exists({ batchId: batch.batchId, $or: [{ requiresQualityReview: true }, { activeExcursionKey: { $exists: true } }] })) return res.status(409).json({ error: "Close excursions and clear existing holds before changing policy" });
    const policy = await Policy.create({ ...value, batchId: batch.batchId, vaccineType: batch.vaccineType, approvedBy: req.user.id });
    await Audit.create({ batchId: batch.batchId, action: "POLICY_APPROVED", actorId: req.user.id, reason: value.approvalReason, eventTime: new Date(), snapshot: policy.toObject() });
    batch.coldChainPolicyId = policy._id;
    await batch.save();
    return res.status(201).json({ batchId: batch.batchId, policy });
  });
});
exports.setBatchTemperaturePolicy = handler(async (req, res) => {
  // Legacy configuration remains readable/writable, but is NOT an approved policy.
  const schema = Joi.object({ minimumTemperature: Joi.number().required(), maximumTemperature: Joi.number().greater(Joi.ref("minimumTemperature")).required(), warningDeviationCelsius: Joi.number().min(0) });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  const batch = await Batch.findOne({ batchId: req.params.batchId });
  if (!batch) return notFound(res);
  if (!canAccessBatch(req, batch)) return denied(res);
  await Audit.create({ batchId: batch.batchId, action: "LEGACY_POLICY_DRAFT_UPDATED", actorId: req.user.id, reason: "Unapproved legacy limits updated", eventTime: new Date(), snapshot: value });
  batch.temperaturePolicy = value;
  await batch.save();
  return res.json({ batchId: batch.batchId, temperaturePolicy: value, note: "Draft only; approve a ColdChainPolicy revision to enable evaluation" });
});
exports.checkTelemetry = handler(async (req, res) => {
  if (!isOperator(req)) return denied(res);
  const { error, value } = Joi.object({ batchId: Joi.string().required(), asOf: Joi.string().isoDate().required() }).validate(req.body);
  if (error) return res.status(400).json({ error: error.message });
  const batch = await Batch.findOne({ batchId: value.batchId }).lean();
  if (!batch) return notFound(res);
  if (!canAccessBatch(req, batch)) return denied(res);
  return res.json({ alerts: await checkMissingTelemetry(value.batchId, value.asOf) });
});
