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
  const [batch, shipment] = await Promise.all([
    Batch.findOne({ batchId: alert.batchId }).select("manufacturer vaccineType").lean(),
    alert.shipmentId ? Shipment.findOne({ shipmentId: alert.shipmentId, batchId: alert.batchId }).lean() : null,
  ]);
  const manufacturerKey = alert.manufacturerKey || normaliseKey(batch?.manufacturer);
  if (manufacturerKey) recipients.push({ recipientRole: "manufacturer", recipientRefKey: manufacturerKey });
  // Route only through the shipment attached to this event. A batch may have
  // unrelated deliveries to other distributors or hospitals.
  if (shipment?.distributor) recipients.push({ recipientRole: "distributor", recipientRefKey: normaliseKey(shipment.distributor) });
  if (shipment?.destination) recipients.push({ recipientRole: "healthcare", recipientRefKey: normaliseKey(shipment.destination) });
  const unique = [...new Map(recipients.map(r => [`${r.recipientRole}:${r.recipientRefKey}`, r])).values()];
  const source = alert.context?.source || "temperature-ingestion";
  const automaticSimulator = ["auto-simulated", "software-iot-simulator"].includes(source);
  const sourceLabel = source === "manual-override" || alert.context?.overrideId
    ? "Manual sensor override" : automaticSimulator ? "Automatic simulator" : "Temperature ingestion";
  const metric = alert.metric === "HUMIDITY" ? "humidity" : alert.metric === "TEMPERATURE" ? "temperature" : "telemetry reliability";
  const limit = alert.breachedLimit == null ? "not applicable" : `${alert.breachedLimit}${alert.metric === "HUMIDITY" ? "%" : "°C"}`;
  const reading = alert.metric === "HUMIDITY"
    ? `${alert.currentHumidity ?? alert.currentReading?.humidity ?? "unknown"}% humidity`
    : alert.metric === "TEMPERATURE"
      ? `${alert.currentTemperature ?? alert.currentReading?.temperature ?? "unknown"}°C`
      : `${alert.currentTemperature ?? "unknown"}°C, ${alert.currentHumidity ?? "unknown"}% humidity`;
  const durationMinutes = Number(alert.excursionDurationMs || 0) / 60000;
  const shipmentId = alert.shipmentId || "Unassigned shipment";
  const vaccine = alert.vaccineType || batch?.vaccineType || "Vaccine not recorded";
  const distributor = shipment?.distributor || "Unassigned";
  const hospital = shipment?.destination || "Unassigned";
  const rolePath = { admin: "/admin", manufacturer: "/manufacturer", distributor: "/distributor", healthcare: "/hospital" };
  const message = `${alert.reason} Shipment ${shipmentId} · Batch ${alert.batchId} · ${vaccine}. ${metric} breached limit ${limit}; current reading ${reading}; duration ${durationMinutes.toFixed(2)} simulated minutes. Source: ${sourceLabel}. Distributor: ${distributor}; hospital: ${hospital}. Recommended action: ${alert.recommendedAction}`;
  for (const recipient of unique) {
    const deduplicationKey = `${alert.alertId}:${stage}:${recipient.recipientRole}:${recipient.recipientRefKey}`;
    const deepLink = `${rolePath[recipient.recipientRole] || "/admin"}#shipment-journey`;
    await Notification.updateOne({ deduplicationKey }, { $setOnInsert: {
      ...recipient, recipientRef: recipient.recipientRefKey, deduplicationKey,
      alertId: alert.alertId, auditBatchId: alert.batchId,
      title: `Application Notification: ${stage.replaceAll("_", " ")}`,
      message,
      type: stage === "QUARANTINED" ? "error" : "info",
      metadata: { source: alert.context?.source, stage,
        simulated: ["software-iot-simulator", "auto-simulated", "manual-override"].includes(alert.context?.source),
        sourceLabel, overrideId: alert.context?.overrideId, alertId: alert.alertId,
        shipmentId, batchId: alert.batchId, vaccineType: vaccine, distributor, hospital,
        metric: alert.metric, breachedLimit: alert.breachedLimit,
        currentReading: alert.currentReading || { temperature: alert.currentTemperature, humidity: alert.currentHumidity },
        excursionDurationMs: alert.excursionDurationMs || 0, recommendedAction: alert.recommendedAction,
        deepLink },
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
