const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Notification = require("../models/Notification");
const ColdChainAudit = require("../models/ColdChainAudit");
const HOLD_STATUS = "Quarantined—pending quality review";
const normaliseKey = (value) => String(value || "").trim().toLowerCase();
async function audit(alert, action, actorId, reason, eventTime, snapshot = {}) {
  return ColdChainAudit.create({ batchId: alert.batchId, alertId: alert.alertId, action, actorId, reason, eventTime, snapshot });
}
async function notify(alert, stage) {
  const recipients = [{ recipientRole: "admin", recipientRefKey: "" }];
  if (alert.manufacturerKey) recipients.push({ recipientRole: "manufacturer", recipientRefKey: alert.manufacturerKey });
  if (["QUARANTINED", "CLEARED"].includes(stage)) {
    const shipments = await Shipment.find({ batchId: alert.batchId }).lean();
    for (const shipment of shipments) {
      if (shipment.distributor) recipients.push({ recipientRole: "distributor", recipientRefKey: normaliseKey(shipment.distributor) });
      if (shipment.destination) recipients.push({ recipientRole: "healthcare", recipientRefKey: normaliseKey(shipment.destination) });
    }
  }
  const unique = [...new Map(recipients.map(r => [`${r.recipientRole}:${r.recipientRefKey}`, r])).values()];
  for (const recipient of unique) {
    const deduplicationKey = `${alert.alertId}:${stage}:${recipient.recipientRole}:${recipient.recipientRefKey}`;
    await Notification.updateOne({ deduplicationKey }, { $setOnInsert: {
      ...recipient, recipientRef: recipient.recipientRefKey, deduplicationKey,
      alertId: alert.alertId, auditBatchId: alert.batchId,
      title: `Application Notification: ${stage.replaceAll("_", " ")}`,
      message: `${alert.batchId}: ${alert.reason} ${alert.recommendedAction}`,
      type: stage === "QUARANTINED" ? "error" : "info",
      metadata: { source: alert.context?.source, stage, simulated: alert.context?.source === "software-iot-simulator", alertId: alert.alertId },
    } }, { upsert: true });
  }
  alert.notificationTargets = [...new Set([...(alert.notificationTargets || []), ...unique.map(r => `${r.recipientRole}:${r.recipientRefKey || "all"}`)])];
  await alert.save();
}
async function quarantine(alert, actorId, reason, eventTime) {
  const isNewHold = !alert.requiresQualityReview;
  if (isNewHold) await audit(alert, "QUARANTINE_AUTHORIZED", actorId, reason, eventTime, { policy: alert.policySnapshot, reasons: alert.reasons });
  if (isNewHold) {
    alert.reviewedBy = undefined; alert.reviewedAt = undefined; alert.reviewReason = undefined; alert.reviewEvidence = undefined;
    alert.resolvedAt = undefined; alert.resolvedBy = undefined; alert.resolutionReason = undefined;
  }
  alert.requiresQualityReview = true;
  alert.phase = "QUARANTINED";
  alert.status = alert.status === "RESOLVED" ? "ACTIVE" : alert.status;
  alert.severity = "CRITICAL";
  alert.recommendedAction = "Quarantine shipment and request quality review. Dispatch and administration are blocked.";
  await alert.save();
  await Batch.updateOne({ batchId: alert.batchId }, {
    $addToSet: { coldChainHoldAlertIds: alert.alertId }, $set: { coldChainStatus: HOLD_STATUS },
  });
  await Shipment.updateMany({ batchId: alert.batchId }, {
    $addToSet: { coldChainHoldAlertIds: alert.alertId }, $set: { coldChainStatus: HOLD_STATUS },
  });
  if (isNewHold) await audit(alert, "QUARANTINE", actorId, reason, eventTime, { policy: alert.policySnapshot, reasons: alert.reasons });
  await notify(alert, "QUARANTINED");
  return alert;
}
module.exports = { audit, notify, quarantine, normaliseKey, HOLD_STATUS };
