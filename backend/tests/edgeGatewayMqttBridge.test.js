jest.mock("mqtt", () => ({ connect: jest.fn() }));

const { EventEmitter } = require("node:events");
const mqtt = require("mqtt");
const { handleTelemetryMessage, startMqttBridge, brokerUrl, topicPrefix } = require("../edge-gateway/mqttBridge");

const envelope = {
  messageId: "mqtt-message-001", correlationId: "edge.mqtt.1",
  telemetry: {
    shipmentId: "SHIP-EDGE-01", batchId: "BATCH-EDGE-01", deviceId: "DEVICE-EDGE-01",
    vehicleId: "TRUCK-EDGE-01", temperature: 5.2, humidity: 58, batteryLevel: 92,
    recordedAt: new Date(Date.now() - 60 * 1000).toISOString(), location: { lat: 9.9312, lng: 76.2673 },
    source: "auto-simulated", simulation: { source: "software-iot-simulator", tick: 1 },
  },
};

describe("Edge Gateway MQTT bridge", () => {
  const prefix = "vaccine/telemetry";
  test("forwards valid telemetry and acknowledges only after backend persistence", async () => {
    const forward = jest.fn(async (rows, context) => [{ _id: "stored-by-backend", ...rows[0], context }]);
    const publishAck = jest.fn().mockResolvedValue(undefined);
    const result = await handleTelemetryMessage({ topic: `${prefix}/TRUCK-EDGE-01/BATCH-EDGE-01`,
      rawMessage: Buffer.from(JSON.stringify(envelope)), prefix, forward, publishAck });

    expect(result.ok).toBe(true);
    expect(result.record._id).toBe("stored-by-backend");
    expect(forward).toHaveBeenCalledWith([expect.objectContaining({ correlationId: "edge.mqtt.1" })],
      { correlationId: "edge.mqtt.1", transport: "mqtt" });
    expect(publishAck).toHaveBeenCalledWith(`${prefix}/ack/mqtt-message-001`, expect.objectContaining({
      ok: true, correlationId: "edge.mqtt.1",
    }));
  });

  test("rejects vehicle/batch topic mismatch without calling the backend", async () => {
    const forward = jest.fn();
    const publishAck = jest.fn().mockResolvedValue(undefined);
    const result = await handleTelemetryMessage({ topic: `${prefix}/OTHER-TRUCK/BATCH-EDGE-01`,
      rawMessage: Buffer.from(JSON.stringify(envelope)), prefix, forward, publishAck });
    expect(result.ok).toBe(false);
    expect(forward).not.toHaveBeenCalled();
    expect(publishAck).toHaveBeenCalledWith(`${prefix}/ack/mqtt-message-001`, expect.objectContaining({ ok: false }));
  });

  test("rejects malformed JSON without attempting persistence", async () => {
    const forward = jest.fn();
    await handleTelemetryMessage({ topic: `${prefix}/TRUCK/BATCH`, rawMessage: Buffer.from("{"), prefix, forward });
    expect(forward).not.toHaveBeenCalled();
  });

  test("subscribes to the telemetry topic on broker connection", () => {
    const client = new EventEmitter();
    client.subscribe = jest.fn((_topic, _options, callback) => callback(null));
    client.publish = jest.fn();
    mqtt.connect.mockReturnValue(client);
    const forward = jest.fn();
    const bridge = startMqttBridge({ forward, url: "mqtt://127.0.0.1:1883", prefix, client });
    client.emit("connect");
    expect(bridge.telemetryTopic).toBe(`${prefix}/+/+`);
    expect(client.subscribe).toHaveBeenCalledWith(`${prefix}/+/+`, { qos: 1 }, expect.any(Function));
  });

  test("rejects remote plaintext brokers and MQTT wildcard prefixes", () => {
    expect(() => brokerUrl("mqtt://broker.example.test:1883")).toThrow("require mqtts:// TLS");
    expect(() => topicPrefix("vaccine/+/telemetry")).toThrow("cannot be empty or contain MQTT wildcards");
  });
});
