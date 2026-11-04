const mongoose = require("mongoose");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Order = require("../models/Order");
const TemperatureLog = require("../models/TemperatureLog");
const Alert = require("../models/TemperatureAlert");
const Audit = require("../models/ColdChainAudit");
const Notification = require("../models/Notification");
const Vaccination = require("../models/Vaccination");
const Policy = require("../models/ColdChainPolicy");
const InventoryCertificate = require("../models/InventoryCertificate");
const User = require("../models/user");
const { identityKeys } = require("../middleware/identityScope");
const { getBatchLifecycleFromChain } = require("../services/blockchainService");
const { collectBatchTransactions, annotateLifecycleWithTransactions } = require("./batchController");

const norm = value => String(value || "").trim().toLowerCase();
const actorRole = value => ({ admin: "Admin", manufacturer: "Manufacturer", distributor: "Distributor", healthcare: "Hospital", sensor: "Virtual sensor" }[norm(value)] || value || "System");
function asEvent(kind, title, at, role, actor, detail = "", extra = {}) {
  const date = at ? new Date(at) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  return { id: `${kind}:${extra.id || title}:${date.toISOString()}`, kind, title, at: date.toISOString(), role: actorRole(role), actor: actor || "System", detail, ...extra };
}
function shipmentActor(status, shipment) {
  const value = norm(status);
  if (value.includes("confirm")) return { role: "healthcare", actor: shipment.destination || "Hospital" };
  if (value.includes("new shipment required") || shipment.orderId && (value.includes("pending") || value.includes("created"))) return { role: "admin", actor: "Order allocation" };
  if (value.includes("pending") || value.includes("created")) return { role: "distributor", actor: shipment.distributor || "Distributor" };
  return { role: "distributor", actor: shipment.distributor || "Distributor" };
}
function auditTitle(action) {
  return String(action || "Cold-chain review").replaceAll("_", " ").replaceAll("SYSTEM ", "").trim();
}

async function visibleAlerts(req, batchId) {
  if (req.user.role === "admin") return Alert.find({ batchId }).sort({ timestamp: 1 }).lean();
  if (req.user.role === "manufacturer") {
    const keys = identityKeys(req.user);
    return Alert.find({ batchId, manufacturerKey: { $in: keys } }).sort({ timestamp: 1 }).lean();
  }
  const recipientRole = req.user.role;
  const ids = await Notification.distinct("alertId", {
    recipientRole, alertId: { $exists: true }, recipientRefKey: { $in: identityKeys(req.user) },
  });
  return Alert.find({ batchId, alertId: { $in: ids } }).sort({ timestamp: 1 }).lean();
}

const internalRole = role => ["admin", "manufacturer"].includes(role);
const transactionReference = (source, label, txHash, timestamp, correlation = "stored-reference") =>
  txHash ? { source, label, txHash, timestamp: timestamp || null, correlation } : null;

exports.listBatches = async (req, res) => {
  try {
    const batches = await Batch.find(req.scope.batch).select("batchId vaccineType status coldChainStatus").sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ batches });
  } catch (_) { return res.status(503).json({ error: "Traceability records are unavailable" }); }
};

exports.getJourney = async (req, res) => {
  const batchId = String(req.params.batchId || "").trim();
  if (!batchId || batchId.length > 120) return res.status(400).json({ error: "A valid batchId is required" });
  try {
    const canSeeManufacturerInternals = internalRole(req.user.role);
    const batchProjection = canSeeManufacturerInternals
      ? "batchId vaccineType quantity manufacturer status coldChainStatus coldChainPolicyId coldChainHoldAlertIds disposition productionApproved productionApprovedAt productionSigner labApproved labApprovedAt labSigner releaseVisibleToExternal releaseApprovedAt releaseStage createdAt expiresAt baselineDemandForecast certificateMinted certificateId certificateTxHash certificateMintedAt certificateUri txHash"
      : "batchId vaccineType quantity manufacturer status coldChainStatus coldChainPolicyId disposition createdAt expiresAt";
    const batch = await Batch.findOne({ $and: [req.scope.batch, { batchId }] })
      .select(batchProjection)
      .lean();
    if (!batch) return res.status(404).json({ error: "Batch not found or not visible to this account" });

    const shipments = await Shipment.find({ $and: [req.scope.shipment, { batchId }] }).sort({ createdAt: 1 }).lean();
    const shipmentIds = shipments.map(shipment => shipment.shipmentId).filter(Boolean);
    const [orders, readings, alerts, administrations, audits, policies, certificate] = await Promise.all([
      Order.find({ $and: [req.scope.order, { $or: [{ allocatedBatchId: batchId }, { shipmentId: { $in: shipmentIds } }] }] }).sort({ createdAt: 1 }).lean(),
      TemperatureLog.find({ $and: [req.scope.telemetry, { $or: [{ batchId }, { shipmentId: { $in: shipmentIds } }] }] }).sort({ recordedAt: 1 }).lean(),
      visibleAlerts(req, batchId),
      Vaccination.find({ $and: [req.scope.vaccination, { $or: [{ batchId }, { shipmentId: { $in: shipmentIds } }] }] }).sort({ date: 1 }).lean(),
      Audit.find({ batchId }).sort({ recordedAt: 1 }).lean(),
      Policy.find({ batchId }).sort({ approvedAt: 1 }).lean(),
      canSeeManufacturerInternals ? InventoryCertificate.findOne({ batchId }).sort({ issuedAt: -1 }).lean() : null,
    ]);
    const actorIds = [...new Set([
      ...orders.map(order => order.reviewedBy), ...shipments.map(shipment => shipment.confirmedBy),
      ...audits.map(entry => entry.actorId), ...policies.map(entry => entry.approvedBy), batch.disposition?.recordedBy,
    ].filter(value => mongoose.isValidObjectId(value)).map(String))];
    const users = actorIds.length ? await User.find({ _id: { $in: actorIds } }).select("email role").lean() : [];
    const usersById = new Map(users.map(user => [String(user._id), user]));
    const describeActor = (id, fallback) => {
      const user = usersById.get(String(id));
      if (user && !canSeeManufacturerInternals) return actorRole(user.role);
      return user?.email || fallback || "System";
    };
    const events = [];

    events.push(asEvent("batch", "Vaccine batch created", batch.createdAt, "manufacturer", batch.manufacturer || "Manufacturer", `${batch.vaccineType || "Vaccine"} · ${Number(batch.quantity || 0).toLocaleString()} doses`, { id: batch.batchId }));
    if (batch.disposition?.status && batch.disposition.status !== "active") {
      events.push(asEvent("disposition", `Batch disposition set: ${batch.disposition.status}`, batch.disposition.recordedAt,
        batch.disposition.recordedByRole, canSeeManufacturerInternals ? describeActor(batch.disposition.recordedBy, "Recorded user") : actorRole(batch.disposition.recordedByRole),
        [batch.disposition.reasonCode, batch.disposition.reason].filter(Boolean).join(" · "), { id: `${batch.batchId}:disposition`, reasonCode: batch.disposition.reasonCode }));
    }
    if (canSeeManufacturerInternals && batch.productionApprovedAt) events.push(asEvent("batch", "Production sign-off recorded", batch.productionApprovedAt, "manufacturer", batch.productionSigner || batch.manufacturer, "Manufacturing release approval", { id: `${batch.batchId}:production` }));
    if (canSeeManufacturerInternals && batch.labApprovedAt) events.push(asEvent("batch", "Laboratory sign-off recorded", batch.labApprovedAt, "manufacturer", batch.labSigner || batch.manufacturer, "Laboratory release approval", { id: `${batch.batchId}:lab` }));
    if (canSeeManufacturerInternals && batch.releaseApprovedAt) events.push(asEvent("batch", "Batch released for distribution", batch.releaseApprovedAt, "manufacturer", batch.manufacturer, batch.releaseStage || "Released", { id: `${batch.batchId}:release` }));
    for (const order of orders) {
      events.push(asEvent("order", "Hospital order placed", order.createdAt, "healthcare", order.hospital || order.centerId, `${order.orderId} · ${Number(order.requestedDoses || 0).toLocaleString()} doses · ${order.status || "Pending"}`, { id: order.orderId, orderId: order.orderId }));
      if (order.reviewedAt) events.push(asEvent("order", `Order ${order.status || "reviewed"}`, order.reviewedAt, "admin", describeActor(order.reviewedBy, "Admin reviewer"), order.adminDecisionNote || order.orderId, { id: `${order.orderId}:review`, orderId: order.orderId }));
    }
    for (const shipment of shipments) {
      const history = Array.isArray(shipment.statusHistory) && shipment.statusHistory.length
        ? shipment.statusHistory : [{ status: shipment.status, timestamp: shipment.lastUpdatedAt || shipment.createdAt }];
      history.forEach(entry => {
        const who = shipmentActor(entry.status, shipment);
        events.push(asEvent("shipment", `Shipment ${entry.status || "updated"}`, entry.timestamp || shipment.createdAt, who.role,
          norm(entry.status).includes("confirm") ? describeActor(shipment.confirmedBy, who.actor) : who.actor,
          `${shipment.shipmentId} · ${shipment.destination || "Destination pending"}`, { id: `${shipment.shipmentId}:${entry.status}:${entry.timestamp}`, shipmentId: shipment.shipmentId, txHash: entry.txHash || "" }));
      });
    }
    readings.forEach(reading => {
      events.push(asEvent("telemetry", "Sensor reading recorded", reading.recordedAt, "sensor",
        reading.deviceId ? `Virtual sensor ${reading.deviceId}` : reading.sensorId || "Temperature sensor",
        `${reading.temperature}°C${reading.humidity == null ? "" : ` · ${reading.humidity}% humidity`}${reading.batteryLevel == null ? "" : ` · ${reading.batteryLevel}% battery`}`,
        { id: reading._id, readingId: reading._id, deviceId: reading.deviceId || reading.sensorId, temperature: reading.temperature, humidity: reading.humidity, batteryLevel: reading.batteryLevel, latitude: reading.location?.lat, longitude: reading.location?.lng }));
      if (reading.evaluation) {
        const evaluation = reading.evaluation;
        const evaluationTitle = evaluation.evaluated
          ? `Policy evaluation · ${evaluation.severity || "NORMAL"} · ${evaluation.violationType || "reading"}`
          : `Policy evaluation · not evaluated · ${evaluation.policyStatus || "status unavailable"}`;
        const evaluationDetail = evaluation.reasons?.length ? evaluation.reasons.join(" ")
          : evaluation.recommendedAction ? `Recommended action: ${evaluation.recommendedAction}.`
            : "Stored evaluation result; detailed reasons were not recorded.";
        events.push(asEvent("evaluation", evaluationTitle, reading.recordedAt, "system", "Explainable cold-chain rules", evaluationDetail,
          { id: `evaluation:${reading._id}`, readingId: String(reading._id), evaluation: {
            evaluated: evaluation.evaluated, policyStatus: evaluation.policyStatus, violationType: evaluation.violationType,
            severity: evaluation.severity, deviation: evaluation.deviation, batchQuarantined: evaluation.batchQuarantined,
            confidence: evaluation.confidence, reasons: evaluation.reasons, recommendedAction: evaluation.recommendedAction,
          } }));
        if (evaluation.anomalyInference) {
          const inference = evaluation.anomalyInference;
          events.push(asEvent("ai_inference", `Advisory anomaly inference · ${inference.status || "status unavailable"}`,
            reading.recordedAt, "system", "Rolling median/MAD statistical detector", inference.reason || "No inference explanation was stored.",
            { id: `anomaly:${reading._id}`, readingId: String(reading._id), anomalyInference: inference }));
        }
      }
    });
    alerts.forEach(alert => events.push(asEvent("alert", `Policy evaluation · ${alert.severity || "alert"} · ${alert.phase || alert.status}`, alert.timestamp, "system", alert.deviceId || "Explainable cold-chain rules", alert.reason,
      { id: alert.alertId, alertId: alert.alertId, severity: alert.severity, phase: alert.phase, status: alert.status,
        recommendedAction: alert.recommendedAction, reasons: alert.reasons, confidence: alert.confidence, policySnapshot: alert.policySnapshot, context: alert.context })));
    for (const audit of audits) {
      const user = usersById.get(String(audit.actorId));
      events.push(asEvent("audit", auditTitle(audit.action), audit.eventTime || audit.recordedAt, user?.role || "system", describeActor(audit.actorId, "Cold-chain rules"), audit.reason, { id: audit._id, alertId: audit.alertId || "" }));
    }
    for (const policyVersion of policies) {
      events.push(asEvent("policy", "Cold-chain policy approved", policyVersion.approvedAt, "admin", canSeeManufacturerInternals ? describeActor(policyVersion.approvedBy, "Designated reviewer") : "Designated reviewer",
        `${policyVersion.minimumTemperature}–${policyVersion.maximumTemperature}°C · ${policyVersion.sourceReference || "Source not recorded"}`, { id: policyVersion._id, policyId: String(policyVersion._id) }));
    }
    administrations.forEach(record => {
      if (record.eventType === "Delivery Confirmation" || Number(record.receivedDoses) > 0) {
        events.push(asEvent("delivery", "Hospital delivery confirmed", record.date, "healthcare", record.hospital || record.centerId || "Hospital", `${record.shipmentId || "Shipment"} · ${Number(record.receivedDoses || 0).toLocaleString()} doses received`, { id: record._id, shipmentId: record.shipmentId || "" }));
      }
      if (record.eventType === "Vaccination" || record.administrationStatus === "Administered" || Number(record.dosesUsed) > 0) {
        events.push(asEvent("administration", "Vaccine administration recorded", record.date, "healthcare", record.healthAuthority || record.hospital || record.centerId || "Hospital", `${Number(record.dosesUsed || 0).toLocaleString()} doses · ${record.vaccineType || batch.vaccineType || "Vaccine"}`, { id: record._id }));
      }
    });
    const activePolicy = batch.coldChainPolicyId ? policies.find(item => String(item._id) === String(batch.coldChainPolicyId)) || null : null;
    const serializePolicy = item => item ? ({ id: String(item._id), vaccineType: item.vaccineType, minimumTemperature: item.minimumTemperature,
      maximumTemperature: item.maximumTemperature, minimumHumidity: item.minimumHumidity, maximumHumidity: item.maximumHumidity,
      excursionDurationMs: item.excursionDurationMs, maximumReadingGapMs: item.maximumReadingGapMs, criticalBatteryPercent: item.criticalBatteryPercent,
      maximumRateCelsiusPerMinute: item.maximumRateCelsiusPerMinute, sourceReference: item.sourceReference, approvedAt: item.approvedAt, rules: item.rules }) : null;
    const serialReadings = readings.map(reading => ({ id: String(reading._id), shipmentId: reading.shipmentId || "",
      source: reading.source || reading.simulation?.telemetrySource || null, recordedAt: reading.recordedAt, temperature: reading.temperature,
      humidity: reading.humidity, batteryLevel: reading.batteryLevel, latitude: reading.location?.lat, longitude: reading.location?.lng,
      deviceId: reading.deviceId || reading.sensorId || "", scenario: reading.simulation?.scenario || "", status: reading.status || "Normal",
      evaluation: reading.evaluation ? { evaluated: reading.evaluation.evaluated, policyStatus: reading.evaluation.policyStatus,
        violationType: reading.evaluation.violationType, severity: reading.evaluation.severity, deviation: reading.evaluation.deviation,
        batchQuarantined: reading.evaluation.batchQuarantined, confidence: reading.evaluation.confidence,
        reasons: reading.evaluation.reasons, recommendedAction: reading.evaluation.recommendedAction,
        anomalyInference: reading.evaluation.anomalyInference || null } : null }));
    let blockchain = { status: "scoped", lifecycle: [], references: [] };
    if (canSeeManufacturerInternals) {
      let transactions = [];
      try { transactions = await collectBatchTransactions(batchId); } catch (_) { /* contract/record references are best-effort, never block the story */ }
      const visibleReferences = transactions.map(item => transactionReference(item.source, item.label, item.txHash, item.timestamp)).filter(Boolean);
      try {
        const chainResult = await getBatchLifecycleFromChain(batchId);
        const lifecycle = annotateLifecycleWithTransactions(chainResult.lifecycle || [], transactions);
        lifecycle.forEach((entry, index) => {
          const timestamp = Number(entry.timestamp);
          const at = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : null;
          events.push(asEvent("blockchain", `Contract event · ${entry.action || "Lifecycle update"}`, at, entry.actorRole || "system", entry.actor || "Local contract",
            [entry.location, entry.details, entry.quantity ? `${entry.quantity} doses` : ""].filter(Boolean).join(" · "),
            { id: `chain:${index}:${entry.timestamp}`, txHash: entry.txHash || "", transactionCorrelation: entry.transactionCorrelation || "unmatched" }));
        });
        blockchain = { status: "available", lifecycle, references: visibleReferences };
      } catch (_) { blockchain = { status: "unavailable", lifecycle: [], references: visibleReferences }; }
    } else {
      const visibleReferences = [
        ...shipments.flatMap(shipment => [transactionReference("Shipment", shipment.status || "Shipment", shipment.txHash, shipment.lastUpdatedAt || shipment.createdAt), ...(shipment.statusHistory || []).map(item => transactionReference("ShipmentHistory", item.status || "Shipment update", item.txHash, item.timestamp))]),
        ...orders.map(order => transactionReference("Order", order.orderId || "Order approval", order.approvalTxHash, order.reviewedAt || order.createdAt)),
        ...administrations.map(record => transactionReference("Vaccination", record.eventType || record.workflowStage || "Hospital record", record.txHash, record.date)),
      ].filter(Boolean).filter((item, index, list) => list.findIndex(candidate => candidate.txHash === item.txHash) === index);
      blockchain = { status: "scoped", lifecycle: [], references: visibleReferences };
    }
    const forecast = canSeeManufacturerInternals && (certificate || batch.certificateMinted || Number(batch.baselineDemandForecast) > 0) ? {
      source: certificate ? "Inventory certificate" : "Batch baseline forecast",
      certificateId: certificate?.certificateId || batch.certificateId || "",
      predictedDemand: certificate?.predictedDemand ?? batch.baselineDemandForecast ?? 0,
      issuedAt: certificate?.issuedAt || batch.certificateMintedAt || null,
      sourceSeries: (certificate?.sourceSeries || []).slice(-100),
    } : null;
    const disposition = batch.disposition ? { ...batch.disposition,
      recordedBy: canSeeManufacturerInternals ? describeActor(batch.disposition.recordedBy, "") : actorRole(batch.disposition.recordedByRole) } : { status: "active" };
    const responseBatch = { ...batch, disposition };
    if (!canSeeManufacturerInternals) delete responseBatch.coldChainPolicyId;
    const serialAlerts = alerts.map(alert => ({ alertId: alert.alertId, severity: alert.severity, status: alert.status, phase: alert.phase,
      timestamp: alert.timestamp, excursionStartedAt: alert.excursionStartedAt, excursionClosedAt: alert.excursionClosedAt,
      requiresQualityReview: alert.requiresQualityReview, reason: alert.reason, recommendedAction: alert.recommendedAction,
      currentTemperature: alert.currentTemperature, minimumAllowedTemperature: alert.minimumAllowedTemperature,
      maximumAllowedTemperature: alert.maximumAllowedTemperature, violationType: alert.violationType, reasons: alert.reasons,
      confidence: alert.confidence, context: alert.context, policySnapshot: alert.policySnapshot,
      notificationTargets: canSeeManufacturerInternals ? alert.notificationTargets : undefined }));
    const response = { batch: responseBatch, policy: serializePolicy(activePolicy), policies: policies.map(({ _id, vaccineType, minimumTemperature, maximumTemperature, minimumHumidity, maximumHumidity,
      excursionDurationMs, maximumReadingGapMs, criticalBatteryPercent, maximumRateCelsiusPerMinute, sourceReference, approvedAt, rules }) => ({ id: String(_id), vaccineType,
      minimumTemperature, maximumTemperature, minimumHumidity, maximumHumidity, excursionDurationMs, maximumReadingGapMs, criticalBatteryPercent,
      maximumRateCelsiusPerMinute, sourceReference, approvedAt, rules })), forecast, blockchain,
      events: events.filter(Boolean).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), readings: serialReadings,
      alerts: serialAlerts };
    if (!canSeeManufacturerInternals) delete response.forecast;
    return res.json(response);
  } catch (_) { return res.status(503).json({ error: "Traceability records could not be assembled" }); }
};
