const mqtt = require("mqtt");
const { normalizeOrCreateCorrelationId, runWithCorrelationId } = require("../services/correlationContext");
const { validateTelemetry } = require("../services/telemetryValidation");
const logger = require("../services/structuredLogger");
const { isAllowedLocalHost } = require("../services/localNetwork");
const { verifyDeviceTelemetry } = require("./deviceAuth");

const validId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function brokerUrl(value = process.env.MQTT_URL || "mqtt://127.0.0.1:1883") {
  const url = new URL(value);
  if (!["mqtt:", "mqtts:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("MQTT_URL must be an mqtt(s) URL without embedded credentials or a fragment");
  }
  const loopback = isAllowedLocalHost(url.hostname);
  if (!loopback && url.protocol !== "mqtts:") throw new Error("Remote MQTT brokers require mqtts:// TLS");
  return url.toString();
}

function topicPrefix(value = process.env.MQTT_TOPIC_PREFIX || "vaccine/telemetry") {
  const prefix = String(value).replace(/^\/+|\/+$/g, "");
  if (!prefix || /[+#]/.test(prefix)) throw new Error("MQTT_TOPIC_PREFIX cannot be empty or contain MQTT wildcards");
  return prefix;
}

function publish(client, topic, payload) {
  return new Promise((resolve, reject) => client.publish(topic, JSON.stringify(payload), { qos: 1, retain: false },
    error => error ? reject(error) : resolve()));
}

async function handleTelemetryMessage({ topic, rawMessage, prefix, forward, publishAck, deviceSecret }) {
  let envelope;
  try { envelope = JSON.parse(rawMessage.toString("utf8")); }
  catch (_) {
    logger.warn("edge_gateway.mqtt.rejected", { reason: "invalid_json" });
    return;
  }
  const telemetry = envelope?.telemetry || envelope;
  const messageId = typeof envelope?.messageId === "string" && validId.test(envelope.messageId) ? envelope.messageId : null;
  const correlationId = normalizeOrCreateCorrelationId(telemetry?.correlationId || envelope?.correlationId);
  let acknowledgement = { messageId, correlationId, ok: false, error: "Telemetry rejected by edge gateway" };
  try {
    const segments = topic.split("/");
    const prefixParts = prefix.split("/");
    if (segments.length !== prefixParts.length + 2 || !prefixParts.every((part, index) => segments[index] === part)) {
      throw new Error("topic_mismatch");
    }
    if (decodeURIComponent(segments.at(-2)) !== String(telemetry.vehicleId || "") ||
      decodeURIComponent(segments.at(-1)) !== String(telemetry.batchId || "") || !telemetry.vehicleId || !telemetry.batchId) {
      throw new Error("identity_mismatch");
    }
    if (deviceSecret && !verifyDeviceTelemetry(deviceSecret, telemetry, envelope.deviceId, envelope.deviceSignature)) {
      throw new Error("invalid_device_signature");
    }
    const { error, value } = validateTelemetry([telemetry]);
    if (error) throw new Error("invalid_telemetry");
    const [reading] = value;
    reading.correlationId = normalizeOrCreateCorrelationId(reading.correlationId || correlationId);
    const [record] = await runWithCorrelationId(reading.correlationId,
      () => forward([reading], { correlationId: reading.correlationId, transport: "mqtt" }));
    if (!record || typeof record !== "object") throw new Error("backend_no_record");
    acknowledgement = { messageId, correlationId: reading.correlationId, ok: true, record };
    logger.info("edge_gateway.telemetry.forwarded", { correlationId: reading.correlationId, messageId,
      batchId: reading.batchId, vehicleId: reading.vehicleId, transport: "mqtt" });
  } catch (error) {
    acknowledgement = { messageId, correlationId, ok: false, error: "Telemetry rejected or upstream unavailable" };
    logger.warn("edge_gateway.mqtt.rejected", { correlationId, messageId,
      reason: error.message || "processing_failure" });
  }
  if (messageId && publishAck) await publishAck(`${prefix}/ack/${messageId}`, acknowledgement);
  return acknowledgement;
}

function startMqttBridge({ forward, url = brokerUrl(), prefix = topicPrefix(), client: injectedClient,
  deviceSecret = process.env.EDGE_GATEWAY_DEVICE_SECRET } = {}) {
  if (typeof forward !== "function") throw new Error("A backend telemetry forwarder is required");
  const client = injectedClient || mqtt.connect(url, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    connectTimeout: 5000,
    reconnectPeriod: 5000,
    clean: true,
  });
  const telemetryTopic = `${prefix}/+/+`;
  const onConnect = () => client.subscribe(telemetryTopic, { qos: 1 }, error => {
    if (error) logger.warn("edge_gateway.mqtt.subscribe_failed", { topic: telemetryTopic });
    else logger.info("edge_gateway.mqtt.subscribed", { topic: telemetryTopic });
  });
  client.on("connect", onConnect);
  client.on("message", (topic, rawMessage) => handleTelemetryMessage({ topic, rawMessage, prefix, forward, deviceSecret,
    publishAck: (ackTopic, payload) => publish(client, ackTopic, payload) }).catch(() => {
    logger.warn("edge_gateway.mqtt.message_failed", { reason: "acknowledgement_or_processing_failure" });
  }));
  client.on("error", () => logger.warn("edge_gateway.mqtt.connection_error", { reason: "broker_connection_error" }));
  return { client, telemetryTopic };
}

module.exports = { brokerUrl, topicPrefix, handleTelemetryMessage, startMqttBridge };
