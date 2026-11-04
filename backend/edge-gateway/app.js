const express = require("express");
const axios = require("axios");
const { timingSafeEqual } = require("node:crypto");
const { validateTelemetry } = require("../services/telemetryValidation");
const { normalizeOrCreateCorrelationId } = require("../services/correlationContext");
const correlationMiddleware = require("../middleware/correlationId");
const logger = require("../services/structuredLogger");
const { isAllowedLocalHost } = require("../services/localNetwork");
const { verifyDeviceTelemetry } = require("./deviceAuth");

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const expected = Buffer.from(left);
  const supplied = Buffer.from(right);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function validateUpstreamUrl(value) {
  const url = new URL(value);
  const loopback = isAllowedLocalHost(url.hostname);
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password ||
    (url.protocol === "http:" && !loopback)) {
    throw new Error("EDGE_GATEWAY_UPSTREAM_URL must use loopback HTTP or HTTPS without embedded credentials");
  }
  return url.toString();
}

function createEdgeGatewayApp({ apiKey, deviceSecret, requireDeviceSignature = false, upstreamApiKey, upstreamUrl, forward, pipeline } = {}) {
  if (!apiKey) throw new Error("EDGE_GATEWAY_API_KEY is required");
  if (!forward && (!upstreamApiKey || !upstreamUrl)) {
    throw new Error("Edge Gateway upstream URL and API key are required");
  }
  const targetUrl = upstreamUrl ? validateUpstreamUrl(upstreamUrl) : null;
  const app = express();
  app.disable("x-powered-by");
  app.use(correlationMiddleware);
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", async (_req, res) => {
    const pendingCount = pipeline?.store?.pendingCount ? await pipeline.store.pendingCount().catch(() => null) : undefined;
    res.json({ service: "edge-gateway", status: "running", mode: "synthetic-software-simulation",
      check: pipeline ? "gateway-and-store" : "process-liveness-only",
      ...(pendingCount === undefined ? {} : { pendingReadings: pendingCount }) });
  });

  app.post("/ingest", async (req, res) => {
    const suppliedKey = req.get("x-api-key");
    if (!safeEqual(apiKey, suppliedKey)) {
      logger.warn("edge_gateway.ingestion.rejected", { correlationId: req.correlationId, reason: "unauthorized" });
      return res.status(401).json({ error: "Invalid API key" });
    }

    const input = Array.isArray(req.body) ? req.body : [req.body];
    if (requireDeviceSignature && input.some(reading => !verifyDeviceTelemetry(deviceSecret, reading,
      req.get("x-device-id") || reading.deviceId, req.get("x-device-signature") || reading.deviceSignature))) {
      logger.warn("edge_gateway.ingestion.rejected", { correlationId: req.correlationId, reason: "invalid_device_signature" });
      return res.status(401).json({ error: "Invalid device identity or telemetry signature" });
    }
    const { error, value } = validateTelemetry(input);
    if (error) {
      logger.warn("edge_gateway.ingestion.rejected", { correlationId: req.correlationId, reason: "invalid_telemetry" });
      return res.status(400).json({ error: error.details.map(detail => detail.message).join("; ") });
    }

    const correlationId = normalizeOrCreateCorrelationId(req.correlationId);
    const readings = value.map(reading => ({ ...reading, correlationId }));
    try {
      const result = pipeline
        ? await Promise.all(readings.map(reading => pipeline.receive(reading, { transport: "http" })))
        : forward
        ? await forward(readings, { correlationId, transport: "http" })
        : (await axios.post(targetUrl, readings, {
          headers: { "x-api-key": upstreamApiKey, "x-correlation-id": correlationId },
          timeout: 5000,
          maxRedirects: 0,
        })).data;
      logger.info("edge_gateway.telemetry.forwarded", { correlationId, readingCount: readings.length, transport: "http" });
      return res.json(result);
    } catch (failure) {
      logger.warn("edge_gateway.upstream.unavailable", { correlationId, readingCount: readings.length,
        reason: failure.response ? "upstream_rejected_or_unavailable" : "upstream_connection_failed" });
      const status = failure.response?.status && failure.response.status < 500 ? failure.response.status : 502;
      return res.status(status).json({ error: "Telemetry could not be forwarded to the backend" });
    }
  });

  return app;
}

module.exports = { createEdgeGatewayApp, safeEqual, validateUpstreamUrl };
