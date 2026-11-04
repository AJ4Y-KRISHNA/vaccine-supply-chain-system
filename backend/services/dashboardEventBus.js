// Best-effort process-local publisher for role-scoped dashboard updates.
// MongoDB remains authoritative; a missed socket event is recovered by REST fallback.
let publisher = null;
function registerPublisher(value) { publisher = value || null; }
function unregisterPublisher(value) { if (publisher === value) publisher = null; }
async function publish(event) {
  if (!publisher) return 0;
  try { return await publisher.publishEvent(event); } catch (_) { return 0; }
}
const valueOf = (record, key) => typeof record?.toObject === "function" ? record.toObject()[key] : record?.[key];
function publishReading(reading, eventType = "READING") {
  const location = valueOf(reading, "location") || {};
  return publish({ type: eventType, correlationId: valueOf(reading, "correlationId"), shipmentId: valueOf(reading, "shipmentId"), batchId: valueOf(reading, "batchId"),
    data: { readingId: String(valueOf(reading, "_id") || ""), batchId: valueOf(reading, "batchId"), shipmentId: valueOf(reading, "shipmentId") || "",
      deviceId: valueOf(reading, "deviceId") || valueOf(reading, "sensorId") || "", vehicleId: valueOf(reading, "vehicleId") || "",
      temperature: valueOf(reading, "temperature"), humidity: valueOf(reading, "humidity"), batteryLevel: valueOf(reading, "batteryLevel"),
      location, recordedAt: valueOf(reading, "recordedAt"), status: valueOf(reading, "status"), synthetic: true } });
}
function publishPosition(reading) {
  const location = valueOf(reading, "location") || {};
  return publish({ type: "SHIPMENT_POSITION", correlationId: valueOf(reading, "correlationId"), shipmentId: valueOf(reading, "shipmentId"), batchId: valueOf(reading, "batchId"),
    data: { shipmentId: valueOf(reading, "shipmentId") || "", batchId: valueOf(reading, "batchId"), vehicleId: valueOf(reading, "vehicleId") || "",
      latitude: location.lat, longitude: location.lng, recordedAt: valueOf(reading, "recordedAt"), synthetic: true } });
}
function publishAlert(alert, action = "UPDATED") {
  const item = typeof alert?.toObject === "function" ? alert.toObject() : alert || {};
  const eventType = action === "OPENED" ? "ALERT_OPENED" : action === "CLOSED" ? "ALERT_CLOSED" : "ALERT_UPDATED";
  return publish({ type: eventType, correlationId: item.correlationId, shipmentId: item.shipmentId, batchId: item.batchId,
    data: { alertId: item.alertId, batchId: item.batchId, shipmentId: item.shipmentId || "", vehicleId: item.vehicleId || "",
      deviceId: item.deviceId || "", metric: item.metric, currentTemperature: item.currentTemperature, currentHumidity: item.currentHumidity,
      minimumAllowedTemperature: item.minimumAllowedTemperature, maximumAllowedTemperature: item.maximumAllowedTemperature,
      minimumAllowedHumidity: item.minimumAllowedHumidity, maximumAllowedHumidity: item.maximumAllowedHumidity,
      latitude: item.latitude, longitude: item.longitude, timestamp: item.timestamp, latestReadingAt: item.latestReadingAt,
      policyReason: item.reason, advisory: { label: item.context?.anomalyInference?.status || "not available",
        explanation: item.context?.anomalyInference?.reason || "No AI advisory is available for this alert." },
      severity: item.severity, phase: item.phase, status: item.status, notifiedRoles: item.notificationTargets || [], synthetic: true } });
}
function publishNotification(notification) {
  const item = typeof notification?.toObject === "function" ? notification.toObject() : notification || {};
  return publish({ type: "NOTIFICATION", correlationId: item.correlationId, batchId: item.auditBatchId || item.metadata?.batchId,
    shipmentId: item.metadata?.shipmentId, targetRole: item.recipientRole, targetOrgKey: item.recipientRefKey || "",
    data: { notificationId: String(item._id || ""), recipientRole: item.recipientRole, title: item.title, message: item.message,
      type: item.type, alertId: item.alertId, batchId: item.auditBatchId || item.metadata?.batchId,
      shipmentId: item.metadata?.shipmentId, createdAt: item.createdAt, synthetic: true } });
}
function publishAnchoring(window, shipmentIds = []) {
  return publish({ type: "ANCHORING_STATUS", correlationId: window.correlationId, batchId: window.batchId, shipmentIds,
    data: { batchId: window.batchId, windowId: window.windowId, windowStart: window.windowStart,
      windowEnd: window.windowEnd, count: window.count, status: window.status, txHash: window.txHash || null,
      gasUsed: window.gasUsed || null, gasPerReading: window.gasPerReading || null, synthetic: true } });
}
function publishShipmentStatus(shipment, reason) {
  return publish({ type: "SHIPMENT_UPDATED", shipmentId: shipment.shipmentId, batchId: shipment.batchId,
    data: { shipmentId: shipment.shipmentId, batchId: shipment.batchId, status: shipment.status,
      reason, recordedAt: new Date().toISOString(), synthetic: true } });
}
module.exports = { registerPublisher, unregisterPublisher, publish, publishReading, publishPosition, publishAlert, publishNotification, publishAnchoring, publishShipmentStatus };
