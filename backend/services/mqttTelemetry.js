const mqtt = require("mqtt");
const { randomUUID } = require("node:crypto");
const { toIngestPayload } = require("./simulatorTelemetryTransport");
const { normalizeOrCreateCorrelationId, runWithCorrelationId } = require("./correlationContext");
const logger = require("./structuredLogger");
const { isAllowedLocalHost } = require("./localNetwork");
const { signDeviceTelemetry } = require("../edge-gateway/deviceAuth");

const CONNECT_TIMEOUT_MS = 5000;
const ACK_TIMEOUT_MS = 15000;
let client;
let connectPromise;
let subscribed = false;
let telemetryHandler;
const pendingAcks = new Map();

function brokerUrl() {
  const configured = process.env.MQTT_URL || "mqtt://127.0.0.1:1883";
  const url = new URL(configured);
  if (!["mqtt:", "mqtts:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("MQTT_URL must be an mqtt(s) URL without embedded credentials or a fragment");
  }
  if (!isAllowedLocalHost(url.hostname) && url.protocol !== "mqtts:") {
    throw new Error("Remote MQTT brokers require mqtts:// TLS");
  }
  return url.toString();
}

function topicPrefix() {
  const prefix = String(process.env.MQTT_TOPIC_PREFIX || "vaccine/telemetry").replace(/^\/+|\/+$/g, "");
  if (!prefix || /[+#]/.test(prefix)) throw new Error("MQTT_TOPIC_PREFIX cannot be empty or contain MQTT wildcards");
  return prefix;
}

function topicPart(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required for MQTT telemetry routing`);
  return encodeURIComponent(text);
}

function topicForReading(reading) {
  return `${topicPrefix()}/${topicPart(reading.vehicleId, "vehicleId")}/${topicPart(reading.batchId, "batchId")}`;
}

function settleAck(message) {
  let payload;
  try { payload = JSON.parse(message.toString("utf8")); } catch (_) { return; }
  const pending = pendingAcks.get(payload.messageId);
  if (!pending) return;
  pendingAcks.delete(payload.messageId);
  clearTimeout(pending.timeout);
  if (payload.correlationId && payload.correlationId !== pending.correlationId) {
    pending.reject(new Error("MQTT telemetry acknowledgement correlation ID did not match"));
    return;
  }
  if (payload.ok) pending.resolve(payload.record || null);
  else pending.reject(new Error(payload.error || "MQTT telemetry ingestion failed"));
}

async function connect() {
  if (client?.connected) return client;
  if (connectPromise) return connectPromise;
  const url = brokerUrl();
  connectPromise = new Promise((resolve, reject) => {
    const connection = mqtt.connect(url, {
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectPeriod: 0,
      clean: true,
    });
    client = connection;
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(`MQTT broker connection timed out (${url})`)), CONNECT_TIMEOUT_MS + 250);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      connection.removeListener("connect", onConnect);
      connection.removeListener("error", onInitialError);
      if (error) {
        client = null;
        connectPromise = null;
        connection.end(true);
        reject(error);
      } else {
        const acknowledgementTopic = `${topicPrefix()}/ack/+`;
        connection.subscribe(acknowledgementTopic, { qos: 1 }, error => {
          if (error) logger.warn("mqtt.ack.subscribe_failed", { topic: acknowledgementTopic });
        });
        connection.on("message", (topic, message) => {
          const ackPrefix = `${topicPrefix()}/ack/`;
          if (topic.startsWith(ackPrefix)) settleAck(message);
          else if (telemetryHandler) telemetryHandler(topic, message).catch(() => {
            logger.warn("mqtt.telemetry.message_failed", { reason: "message_parse_or_processing_failure" });
          });
        });
        connection.on("error", () => logger.warn("mqtt.client.error", { reason: "connection_error" }));
        resolve(connection);
      }
    };
    const onConnect = () => finish();
    const onInitialError = error => finish(new Error(`MQTT broker connection failed: ${error.message}`));
    connection.once("connect", onConnect);
    connection.once("error", onInitialError);
  }).finally(() => { connectPromise = null; });
  return connectPromise;
}

function publish(clientRef, topic, payload) {
  return new Promise((resolve, reject) => {
    clientRef.publish(topic, payload, { qos: 1, retain: false }, error => error ? reject(error) : resolve());
  });
}

async function publishSimulationReading(reading) {
  const connection = await connect();
  const messageId = randomUUID();
  const correlationId = normalizeOrCreateCorrelationId(reading.correlationId);
  const ackTopic = `${topicPrefix()}/ack/${messageId}`;
  const ack = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAcks.delete(messageId);
      reject(new Error(`MQTT telemetry publish was not confirmed by the backend within ${ACK_TIMEOUT_MS} ms`));
    }, ACK_TIMEOUT_MS);
    pendingAcks.set(messageId, { resolve, reject, timeout, correlationId });
  });
  try {
    const telemetry = { ...toIngestPayload(reading), correlationId };
    const deviceSecret = process.env.EDGE_GATEWAY_DEVICE_SECRET;
    await publish(connection, topicForReading(reading), JSON.stringify({ messageId, correlationId,
      deviceId: telemetry.deviceId,
      ...(deviceSecret ? { deviceSignature: signDeviceTelemetry(deviceSecret, telemetry) } : {}), telemetry }));
    const record = await ack;
    logger.info("mqtt.telemetry.persisted", { correlationId, messageId, topic: topicForReading(reading) });
    return record;
  } catch (error) {
    const pending = pendingAcks.get(messageId);
    if (pending) { clearTimeout(pending.timeout); pendingAcks.delete(messageId); }
    throw error;
  }
}

async function startTelemetrySubscriber(ingest = require("../controllers/temperatureController").ingestTelemetryPayload) {
  if (String(process.env.MQTT_TELEMETRY_SUBSCRIBER_ENABLED || "true").toLowerCase() === "false") {
    logger.info("mqtt.telemetry.subscriber.disabled", { reason: "disabled_by_configuration" });
    return { connected: false, subscribed: false, disabled: true };
  }
  const connection = await connect();
  if (subscribed) return { connected: true, subscribed: true };
  const prefix = topicPrefix();
  const telemetryTopic = `${prefix}/+/+`;
  const acknowledgementTopic = `${prefix}/ack/+`;
  telemetryHandler = async (topic, rawMessage) => {
    const segments = topic.split("/");
    let envelope;
    try { envelope = JSON.parse(rawMessage.toString("utf8")); }
    catch (_) { throw new Error("Payload must be valid JSON"); }
    const telemetry = envelope?.telemetry || envelope;
    const messageId = typeof envelope?.messageId === "string" ? envelope.messageId : null;
    const correlationId = normalizeOrCreateCorrelationId(telemetry?.correlationId || envelope?.correlationId);
    let ok = false;
    let response;
    try {
      if (segments.length !== prefix.split("/").length + 2 || !topic.startsWith(`${prefix}/`)) throw new Error("Unexpected telemetry topic");
      if (decodeURIComponent(segments[segments.length - 2]) !== String(telemetry.vehicleId || "") ||
        decodeURIComponent(segments[segments.length - 1]) !== String(telemetry.batchId || "")) {
        throw new Error("MQTT topic vehicle/batch do not match the telemetry payload");
      }
      const [record] = await runWithCorrelationId(correlationId,
        () => ingest({ ...telemetry, correlationId }, { correlationId, transport: "mqtt" }));
      if (!record) throw new Error("Telemetry ingestion returned no stored record");
      response = record.toObject ? record.toObject() : record;
      ok = true;
      logger.info("mqtt.telemetry.consumed", { correlationId, messageId, vehicleId: telemetry.vehicleId, batchId: telemetry.batchId });
    } catch (error) {
      response = { error: error.message };
      logger.warn("mqtt.telemetry.rejected", { correlationId, messageId, reason: "validation_or_persistence_failure" });
    }
    if (messageId) await publish(connection, `${prefix}/ack/${messageId}`, JSON.stringify({ messageId, correlationId, ok,
      ...(ok ? { record: response } : { error: response.error }) }));
  };
  await new Promise((resolve, reject) => {
    connection.subscribe([{ topic: telemetryTopic, qos: 1 }, { topic: acknowledgementTopic, qos: 1 }], error => error ? reject(error) : resolve());
  });
  subscribed = true;
  logger.info("mqtt.telemetry.subscriber.ready", { topic: telemetryTopic });
  return { connected: true, subscribed: true, telemetryTopic };
}

async function stopTelemetryClient() {
  subscribed = false;
  telemetryHandler = null;
  for (const [messageId, pending] of pendingAcks) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("MQTT client stopped before telemetry was acknowledged"));
    pendingAcks.delete(messageId);
  }
  const active = client;
  client = null;
  connectPromise = null;
  if (active) await new Promise(resolve => active.end(true, {}, resolve));
}

module.exports = { brokerUrl, topicPrefix, topicForReading, publishSimulationReading, startTelemetrySubscriber, stopTelemetryClient,
  CONNECT_TIMEOUT_MS, ACK_TIMEOUT_MS };
