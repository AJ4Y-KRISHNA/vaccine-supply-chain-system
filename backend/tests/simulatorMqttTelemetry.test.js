jest.mock("mqtt", () => ({ connect: jest.fn() }));

const { EventEmitter } = require("node:events");
const mqtt = require("mqtt");
const { publishSimulationReading, startTelemetrySubscriber, stopTelemetryClient, topicForReading } = require("../services/mqttTelemetry");

function matches(filter, topic) {
  const pattern = filter.split("/");
  const actual = topic.split("/");
  return pattern.length === actual.length && pattern.every((part, index) => part === "+" || part === actual[index]);
}

function makeBrokerClient() {
  const connection = new EventEmitter();
  connection.connected = false;
  connection.filters = [];
  connection.connectOptions = null;
  connection.subscribe = (filters, options, callback) => {
    connection.filters.push(...(Array.isArray(filters) ? filters.map(entry => entry.topic) : [filters]));
    (typeof options === "function" ? options : callback)?.(null);
  };
  connection.publish = (topic, message, _options, callback) => {
    callback(null);
    if (connection.filters.some(filter => matches(filter, topic))) {
      queueMicrotask(() => connection.emit("message", topic, Buffer.from(message)));
    }
  };
  connection.end = (_force, _options, callback) => { connection.connected = false; callback?.(); };
  queueMicrotask(() => { connection.connected = true; connection.emit("connect"); });
  return connection;
}

describe("MQTT simulator telemetry transport", () => {
  const previous = {
    url: process.env.MQTT_URL,
    prefix: process.env.MQTT_TOPIC_PREFIX,
    user: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
  };
  let ingest;

  beforeEach(async () => {
    await stopTelemetryClient();
    process.env.MQTT_URL = "mqtt://127.0.0.1:1883";
    process.env.MQTT_TOPIC_PREFIX = "vaccine/telemetry";
    delete process.env.MQTT_USERNAME;
    delete process.env.MQTT_PASSWORD;
    mqtt.connect.mockReset().mockImplementation(makeBrokerClient);
    ingest = jest.fn(async payload => [{ _id: "saved-mqtt-record", batchId: payload.batchId, temperature: payload.temperature }]);
  });

  afterAll(async () => {
    await stopTelemetryClient();
    if (previous.url === undefined) delete process.env.MQTT_URL; else process.env.MQTT_URL = previous.url;
    if (previous.prefix === undefined) delete process.env.MQTT_TOPIC_PREFIX; else process.env.MQTT_TOPIC_PREFIX = previous.prefix;
    if (previous.user === undefined) delete process.env.MQTT_USERNAME; else process.env.MQTT_USERNAME = previous.user;
    if (previous.password === undefined) delete process.env.MQTT_PASSWORD; else process.env.MQTT_PASSWORD = previous.password;
  });

  test("publishes by vehicle/batch and resolves only after subscriber persistence acknowledgement", async () => {
    await startTelemetrySubscriber(ingest);
    const reading = {
      deviceId: "IOT-1", vehicleId: "TRUCK-1", batchId: "BATCH-1", shipmentId: "SHIP-1",
      temperature: 7.2, humidity: 61, batteryLevel: 95, latitude: 9.93, longitude: 76.26,
      timestamp: "2026-10-04T12:00:00.000Z", correlationId: "trace.mqtt-5", simulation: { tick: 3, scenario: "NORMAL" },
    };

    const saved = await publishSimulationReading(reading);

    expect(topicForReading(reading)).toBe("vaccine/telemetry/TRUCK-1/BATCH-1");
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      vehicleId: "TRUCK-1", batchId: "BATCH-1", deviceId: "IOT-1", temperature: 7.2,
      location: { lat: 9.93, lng: 76.26 }, correlationId: "trace.mqtt-5",
    }), { correlationId: "trace.mqtt-5", transport: "mqtt" });
    expect(saved).toEqual({ _id: "saved-mqtt-record", batchId: "BATCH-1", temperature: 7.2 });
    expect(mqtt.connect.mock.results[0].value.filters).toContain("vaccine/telemetry/ack/+");
  });

  test("can disable the legacy backend subscriber when the Edge Gateway owns MQTT consumption", async () => {
    const previous = process.env.MQTT_TELEMETRY_SUBSCRIBER_ENABLED;
    process.env.MQTT_TELEMETRY_SUBSCRIBER_ENABLED = "false";
    await expect(startTelemetrySubscriber(ingest)).resolves.toEqual({ connected: false, subscribed: false, disabled: true });
    expect(mqtt.connect).not.toHaveBeenCalled();
    if (previous === undefined) delete process.env.MQTT_TELEMETRY_SUBSCRIBER_ENABLED;
    else process.env.MQTT_TELEMETRY_SUBSCRIBER_ENABLED = previous;
  });

  test("rejects remote plaintext brokers", () => {
    process.env.MQTT_URL = "mqtt://broker.example.test:1883";
    expect(() => require("../services/mqttTelemetry").brokerUrl()).toThrow("Remote MQTT brokers require mqtts:// TLS");
  });
});
