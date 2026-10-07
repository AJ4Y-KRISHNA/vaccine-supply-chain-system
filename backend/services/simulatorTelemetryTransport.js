const axios = require("axios");
const logger = require("./structuredLogger");
const { isAllowedLocalHost } = require("./localNetwork");
const { signDeviceTelemetry } = require("../edge-gateway/deviceAuth");

const timeoutCandidate = Number(process.env.SIMULATOR_HTTP_TIMEOUT_MS || 5000);
const REQUEST_TIMEOUT_MS = Number.isFinite(timeoutCandidate)
  ? Math.max(1000, Math.min(60000, timeoutCandidate)) : 5000;

function getIngestUrl() {
  const configured = process.env.SIMULATOR_INGEST_URL;
  const port = Number(process.env.PORT) || 5000;
  const url = new URL(configured || `http://127.0.0.1:${port}/api/temperature/ingest`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("SIMULATOR_INGEST_URL must be an HTTP(S) URL without embedded credentials");
  }
  if (url.protocol === "http:" && !isAllowedLocalHost(url.hostname)) {
    throw new Error("Remote simulator ingestion requires HTTPS to protect the temperature API key");
  }
  return url.toString();
}

function toIngestPayload(reading) {
  const simulation = reading.simulation || {};
  return {
    ...(reading.correlationId ? { correlationId: reading.correlationId } : {}),
    shipmentId: reading.shipmentId || "",
    batchId: reading.batchId || "",
    sensorId: reading.deviceId || "",
    deviceId: reading.deviceId || "",
    vehicleId: reading.vehicleId || "",
    sequenceNumber: reading.sequenceNumber ?? simulation.tick,
    source: reading.source,
    overrideId: reading.overrideId,
    operatorUserId: reading.operatorUserId,
    temperature: reading.temperature,
    humidity: reading.humidity,
    batteryLevel: reading.batteryLevel,
    recordedAt: reading.timestamp,
    location: {
      lat: reading.latitude,
      lng: reading.longitude,
    },
    simulation: {
      source: simulation.source || "software-iot-simulator",
      telemetrySource: simulation.telemetrySource,
      overrideId: simulation.overrideId,
      operatorUserId: simulation.operatorUserId,
      scenario: simulation.scenario,
      seed: simulation.seed === undefined ? undefined : String(simulation.seed),
      tick: simulation.tick,
    },
  };
}

async function postSimulationReading(reading) {
  const transport = String(process.env.SIMULATOR_TRANSPORT || "mqtt").trim().toLowerCase();
  if (!["mqtt", "http"].includes(transport)) throw new Error("SIMULATOR_TRANSPORT must be mqtt or http");
  if (transport === "mqtt") {
    try {
      return await require("./mqttTelemetry").publishSimulationReading(reading);
    } catch (error) {
      if (String(process.env.SIMULATOR_HTTP_FALLBACK || "true").toLowerCase() !== "true") throw error;
      logger.warn("simulator.mqtt.fallback_to_http", { correlationId: reading.correlationId, reason: "mqtt_transport_unavailable" });
    }
  }

  const apiKey = process.env.SIMULATOR_INGEST_API_KEY || process.env.TEMP_API_KEY;
  if (!apiKey) throw new Error("SIMULATOR_INGEST_API_KEY or TEMP_API_KEY must be configured for simulator HTTP ingestion");

  let response;
  const payload = toIngestPayload(reading);
  const deviceSecret = process.env.EDGE_GATEWAY_DEVICE_SECRET;
  try {
    response = await axios.post(getIngestUrl(), payload, {
      headers: { "x-api-key": apiKey,
        ...(deviceSecret ? { "x-device-id": payload.deviceId, "x-device-signature": signDeviceTelemetry(deviceSecret, payload) } : {}),
        ...(reading.correlationId ? { "x-correlation-id": reading.correlationId } : {}) },
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
    });
  } catch (error) {
    const status = error.response?.status;
    if (status) {
      const detail = error.response.data?.error;
      const suffix = detail ? `: ${Array.isArray(detail) ? detail.join("; ") : detail}` : "";
      throw new Error(`Simulator HTTP ingestion rejected the reading (HTTP ${status})${suffix}`);
    }
    if (error.code === "ECONNABORTED") throw new Error("Simulator HTTP ingestion timed out");
    if (error.code) throw new Error(`Simulator HTTP ingestion failed (${error.code})`);
    throw new Error(`Simulator HTTP ingestion failed: ${error.message}`);
  }

  const records = Array.isArray(response.data) ? response.data : [response.data];
  if (!records[0] || typeof records[0] !== "object") {
    throw new Error("Simulator HTTP ingestion returned no persisted telemetry record");
  }
  return records[0];
}

module.exports = { getIngestUrl, toIngestPayload, postSimulationReading, REQUEST_TIMEOUT_MS };
