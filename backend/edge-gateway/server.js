require("dotenv").config({ path: require("node:path").join(__dirname, ".env"), quiet: true });
const http = require("node:http");
const { createEdgeGatewayApp, validateUpstreamUrl } = require("./app");
const { startMqttBridge } = require("./mqttBridge");
const logger = require("../services/structuredLogger");
const mongoose = require("mongoose");
const MongoGatewayStore = require("./mongoStore");
const { EdgeGatewayPipeline } = require("./pipeline");
const EdgeGatewayQueue = require("../models/EdgeGatewayQueue");

const host = process.env.EDGE_GATEWAY_HOST || "127.0.0.1";
const port = Number(process.env.EDGE_GATEWAY_PORT || 5100);
const apiKey = process.env.EDGE_GATEWAY_API_KEY;
const deviceSecret = process.env.EDGE_GATEWAY_DEVICE_SECRET;
const upstreamApiKey = process.env.EDGE_GATEWAY_UPSTREAM_API_KEY;
const upstreamUrl = process.env.EDGE_GATEWAY_UPSTREAM_URL || "http://127.0.0.1:5000/api/temperature/ingest";
const prefix = process.env.MQTT_TOPIC_PREFIX || "vaccine/telemetry";
const mongoUri = process.env.MONGO_URI;

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("EDGE_GATEWAY_PORT must be a valid TCP port");
const composeOnlyBind = process.env.DOCKER_COMPOSE === "true" && host === "0.0.0.0";
if (!composeOnlyBind && !["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error("The HTTP Edge Gateway binds to loopback only because inbound HTTP does not terminate TLS");
}
if (!apiKey || !deviceSecret || !upstreamApiKey) throw new Error("EDGE_GATEWAY_API_KEY, EDGE_GATEWAY_DEVICE_SECRET and EDGE_GATEWAY_UPSTREAM_API_KEY must be configured");
if (!mongoUri) throw new Error("MONGO_URI is required for the persistent edge store-and-forward queue");
validateUpstreamUrl(upstreamUrl);

const store = new MongoGatewayStore();
const axios = require("axios");
const forward = async (readings, { correlationId } = {}) => {
  const response = await axios.post(upstreamUrl, readings, { headers: { "x-api-key": upstreamApiKey,
    ...(correlationId ? { "x-correlation-id": correlationId } : {}) }, timeout: 5000, maxRedirects: 0 });
  return Array.isArray(response.data) ? response.data : [response.data];
};
const pipeline = new EdgeGatewayPipeline({ store, forward,
  heartbeatMs: Number(process.env.EDGE_GATEWAY_HEARTBEAT_MS || 30000),
  edgeOptions: { minimumTemperature: Number(process.env.EDGE_MIN_TEMPERATURE || 2),
    maximumTemperature: Number(process.env.EDGE_MAX_TEMPERATURE || 8) } });
const app = createEdgeGatewayApp({ apiKey, deviceSecret, requireDeviceSignature: true, upstreamApiKey, upstreamUrl, pipeline });
const server = http.createServer(app);
let mqttBridge;
let flushTimer;
mongoose.connect(mongoUri).then(async () => {
  await Promise.all([EdgeGatewayQueue.init(), require("../models/EdgeGatewayState").init()]);
  server.listen(port, host, () => logger.info("edge_gateway.http.ready", { host, port, upstreamUrl }));
  flushTimer = setInterval(() => pipeline.flushAll().catch(() => logger.warn("edge_gateway.buffer.flush_failed", { reason: "upstream_unavailable" })),
    Number(process.env.EDGE_GATEWAY_FLUSH_INTERVAL_MS || 3000));
  flushTimer.unref?.();
  if (String(process.env.EDGE_GATEWAY_MQTT_ENABLED || "true").toLowerCase() === "true") {
    try {
      mqttBridge = startMqttBridge({ prefix, deviceSecret, forward: async (readings, context) =>
        Promise.all(readings.map(reading => pipeline.receive(reading, context))) });
    } catch (_) { logger.warn("edge_gateway.mqtt.disabled", { reason: "broker_configuration_invalid" }); }
  } else logger.info("edge_gateway.mqtt.disabled", { reason: "disabled_by_configuration" });
}).catch(error => {
  logger.error("edge_gateway.startup.failed", { reason: error.message });
  process.exitCode = 1;
});

function shutdown() {
  if (flushTimer) clearInterval(flushTimer);
  if (mqttBridge) mqttBridge.client.end(true);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
