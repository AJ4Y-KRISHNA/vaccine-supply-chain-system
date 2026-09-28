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

const responseActionSchema = Joi.object({
  action: Joi.string().valid("inspect", "reroute", "hold", "discard-review").required(),
  reason: Joi.string().trim().min(3).max(2000).required(),
});
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
const keysFor = req => require("../middleware/identityScope").identityKeys(req.user);
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
function responseStateFor(alert) {
  if (alert.responseState && !alert.$isDefault?.("responseState")) return alert.responseState;
  if (alert.status === "ACKNOWLEDGED") return "ACKNOWLEDGED";
  if (alert.status === "RESOLVED") return "RESOLVED";
  return "OPEN";
}
function escalationThresholdMs() {
  const configured = Number(process.env.COLD_CHAIN_ALERT_ESCALATION_AFTER_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 7 * 24 * 60 * 60 * 1000) : 5 * 60 * 1000;
}
function batchStoryLink(role) {
  const rolePath = { admin: "/admin", manufacturer: "/manufacturer", distributor: "/distributor", healthcare: "/hospital" };
  return `${rolePath[role] || "/"}#shipment-journey`;
}
async function includeResponseState(alerts, role) {
  if (!alerts.length) return alerts;
  const batchIds = [...new Set(alerts.map(alert => alert.batchId).filter(Boolean))];
  const states = await State.find({ batchId: { $in: batchIds } }).select("batchId shipmentId deviceId checkedAt lastReadingAt").lean();
  return alerts.map(record => {
    const alert = typeof record.toObject === "function" ? record.toObject() : { ...record };
    const matchingStates = states.filter(state => state.batchId === alert.batchId &&
      (!alert.shipmentId || state.shipmentId === alert.shipmentId) &&
      (!alert.deviceId || state.deviceId === alert.deviceId));
    const simulationNow = matchingStates.reduce((latest, state) => Math.max(latest, +state.checkedAt || 0, +state.lastReadingAt || 0),
      +alert.latestReadingAt || +alert.timestamp || 0);
    const responseState = responseStateFor(alert);
    const threshold = escalationThresholdMs();
    const escalationAt = alert.excursionStartedAt ? new Date(+alert.excursionStartedAt + threshold) : null;
    const escalated = responseState === "OPEN" && Boolean(escalationAt) && simulationNow >= +escalationAt;
    return { ...alert, responseState, escalationAfterMs: threshold, escalated, escalationAt, deepLink: batchStoryLink(role) };
  });
}

exports.getAlerts = handler(async (req, res) => {
  const visibility = await alertVisibilityFilter(req);
  if (!visibility) return denied(res);
  const filter = {};
  for (const key of ["status", "severity", "batchId", "shipmentId", "deviceId", "phase", "responseState"]) if (req.query[key]) filter[key] = String(req.query[key]);
  for (const [key, operator] of [["from", "$gte"], ["to", "$lte"]]) {
    if (!req.query[key]) continue;
    const date = new Date(req.query[key]);
    if (!Number.isFinite(date.getTime())) return res.status(400).json({ error: "Invalid date filter" });
    if (key === "to" && /^\d{4}-\d{2}-\d{2}$/.test(req.query[key])) date.setUTCHours(23, 59, 59, 999);
    filter.timestamp = { ...filter.timestamp, [operator]: date };
  }
  const query = { $and: [visibility, filter] };
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const [records, total] = await Promise.all([Alert.find(query).sort({ timestamp: -1 }).limit(limit).lean(), Alert.countDocuments(query)]);
  return res.json({ alerts: await includeResponseState(records, req.user.role), total });
});
exports.getAlertSummary = handler(async (req, res) => {
  const visibility = await alertVisibilityFilter(req);
  if (!visibility) return denied(res);
  const count = filter => Alert.countDocuments({ $and: [visibility, filter] });
  const active = { $or: [
    { responseState: { $in: ["OPEN", "ACKNOWLEDGED", "ACTION_TAKEN"] } },
    { responseState: { $exists: false }, status: { $in: ["ACTIVE", "ACKNOWLEDGED"] } },
  ] };
  const resolvedResponse = { $or: [
    { responseState: "RESOLVED" },
    { responseState: { $exists: false }, status: "RESOLVED" },
  ] };
  const [total, activeCount, critical, warning, resolved, recentRecords] = await Promise.all([
    count({}), count(active), count({ ...active, severity: "CRITICAL" }), count({ ...active, severity: "WARNING" }),
    count(resolvedResponse), Alert.find(visibility).sort({ timestamp: -1 }).limit(8).lean(),
  ]);
  const recent = await includeResponseState(recentRecords, req.user.role);
  return res.json({ total, active: activeCount, critical, warning, resolved, recent,
    permissions: { canManage: isOperator(req), canReview: isReviewer(req) } });
});
exports.getAlertById = handler(async (req, res) => {
  const alert = await visibleAlert(req);
  if (!alert) return notFound(res);
  const auditTrail = await Audit.find({ alertId: alert.alertId }).sort({ recordedAt: 1 }).lean();
  const states = await State.find({ batchId: alert.batchId }).lean();
  const latestClock = states.reduce((last, state) => Math.max(last, +state.lastReadingAt, +state.checkedAt || 0), 0);
  const [decorated] = await includeResponseState([alert], req.user.role);
  return res.json({ alert: decorated, auditTrail, evidenceAsOf: latestClock ? new Date(latestClock).toISOString() : null });
});

// All human actions and evaluations for a batch share a queue in this single-process prototype.
function action(kind) {
  return handler(async (req, res) => {
    if (!isOperator(req) || ["REVIEW", "CLEAR"].includes(kind) && !isReviewer(req)) return denied(res);
    const input = kind === "ACTION_TAKEN" ? responseActionSchema.validate(req.body)
      : reasonSchema.validate(req.body);
    if (input.error) return res.status(400).json({ error: input.error.message });
    const found = await visibleAlert(req);
    if (!found) return notFound(res);
    return withBatchLock(found.batchId, async () => {
      const alert = await Alert.findById(found._id);
      const { reason, asOf } = input.value;
      const responseState = responseStateFor(alert);
      if (kind === "ACKNOWLEDGE") {
        if (responseState !== "OPEN") return res.status(409).json({ error: `Cannot acknowledge a response in state ${responseState}` });
        if (!reason || reason.trim().length < 3) return res.status(400).json({ error: "A note of at least 3 characters is required" });
        const eventTime = alert.latestReadingAt || alert.timestamp;
        await audit(alert, "RESPONSE_ACKNOWLEDGED", req.user.id, reason.trim(), eventTime);
        alert.responseState = "ACKNOWLEDGED"; alert.acknowledgementNote = reason.trim();
        alert.acknowledgedAt = eventTime; alert.acknowledgedBy = req.user.id;
        if (alert.status === "ACTIVE") alert.status = "ACKNOWLEDGED";
        await alert.save();
      } else if (kind === "ACTION_TAKEN") {
        if (responseState !== "ACKNOWLEDGED") return res.status(409).json({ error: `Cannot record an action in state ${responseState}; acknowledge first` });
        const eventTime = alert.latestReadingAt || alert.timestamp;
        await audit(alert, "RESPONSE_ACTION_TAKEN", req.user.id, reason.trim(), eventTime, { action: input.value.action });
        alert.responseState = "ACTION_TAKEN"; alert.actionTaken = input.value.action;
        alert.actionTakenNote = reason.trim(); alert.actionTakenBy = req.user.id; alert.actionTakenAt = eventTime;
        await alert.save();
        if (input.value.action === "hold") await quarantine(alert, req.user.id, reason.trim(), eventTime);
      } else if (kind === "QUARANTINE") {
        if (!["ACKNOWLEDGED", "ACTION_TAKEN"].includes(responseState)) return res.status(409).json({ error: `Cannot place a response hold in state ${responseState}; acknowledge first` });
        if (alert.phase === "CLEARED") return res.status(409).json({ error: "Cleared events cannot be reopened; use the current event" });
        const eventTime = alert.latestReadingAt || alert.timestamp;
        await audit(alert, responseState === "ACKNOWLEDGED" ? "RESPONSE_ACTION_TAKEN" : "RESPONSE_ACTION_CHANGED", req.user.id, reason.trim(), eventTime, { action: "hold" });
        alert.responseState = "ACTION_TAKEN"; alert.actionTaken = "hold"; alert.actionTakenNote = reason.trim();
        alert.actionTakenBy = req.user.id; alert.actionTakenAt = eventTime;
        await alert.save();
        await quarantine(alert, req.user.id, reason.trim(), eventTime);
      } else {
        if (kind === "CLEAR" && responseState === "RESOLVED" && alert.phase === "CLEARED") return res.json({ alert });
        if (responseState !== "ACTION_TAKEN") return res.status(409).json({ error: `Cannot ${kind.toLowerCase()} a response in state ${responseState}; record an action first` });
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
          alert.responseState = "RESOLVED"; alert.responseResolvedNote = reason; alert.responseResolvedBy = req.user.id; alert.responseResolvedAt = clock;
          const otherHold = await Alert.exists({ batchId: alert.batchId, alertId: { $ne: alert.alertId }, requiresQualityReview: true });
          alert.recommendedAction = otherHold ? "This event is cleared; other batch holds still block operations." : "Cold-chain hold cleared; existing workflow eligibility rules still apply.";
          await alert.save();
          await audit(alert, "CLEARED", req.user.id, reason, clock);
          await audit(alert, "RESPONSE_RESOLVED", req.user.id, reason, clock, { actionTaken: alert.actionTaken });
          await notify(alert, "CLEARED");
        }
      }
      return res.json({ alert });
    });
  });
}
exports.acknowledgeAlert = action("ACKNOWLEDGE");
exports.recordResponseAction = action("ACTION_TAKEN");
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
