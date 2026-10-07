const { createHmac, timingSafeEqual } = require("node:crypto");

function canonicalTelemetry(reading) {
  return JSON.stringify({ deviceId: String(reading.deviceId || reading.sensorId || ""),
    vehicleId: String(reading.vehicleId || ""), batchId: String(reading.batchId || ""),
    shipmentId: String(reading.shipmentId || ""), sequenceNumber: reading.sequenceNumber ?? reading.simulation?.tick ?? null,
    temperature: reading.temperature, humidity: reading.humidity ?? null, batteryLevel: reading.batteryLevel ?? null,
    latitude: reading.latitude ?? reading.location?.lat ?? null, longitude: reading.longitude ?? reading.location?.lng ?? null,
    timestamp: reading.timestamp || reading.recordedAt || null });
}

function signDeviceTelemetry(secret, reading) {
  return createHmac("sha256", String(secret)).update(canonicalTelemetry(reading)).digest("hex");
}

function verifyDeviceTelemetry(secret, reading, deviceId, signature) {
  if (!reading || typeof reading !== "object" || !secret || !deviceId || String(deviceId) !== String(reading.deviceId || reading.sensorId || "") ||
      typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signDeviceTelemetry(secret, reading), "hex");
  const supplied = Buffer.from(signature, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

module.exports = { canonicalTelemetry, signDeviceTelemetry, verifyDeviceTelemetry };
