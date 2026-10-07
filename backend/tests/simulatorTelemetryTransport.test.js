const http = require("node:http");
const express = require("express");
const previousKey = process.env.TEMP_API_KEY;
  const previousSimulatorKey = process.env.SIMULATOR_INGEST_API_KEY;
const previousTransport = process.env.SIMULATOR_TRANSPORT;
process.env.SIMULATOR_TRANSPORT = "http";
process.env.TEMP_API_KEY = "test-simulator-ingestion-key";
const recentTimestamp = () => new Date(Date.now() - 60 * 1000).toISOString();
jest.mock("../services/telemetryService", () => ({ persistTemperatureLogs: jest.fn() }));
const { getIngestUrl, postSimulationReading } = require("../services/simulatorTelemetryTransport");
const { persistTemperatureLogs } = require("../services/telemetryService");
const temperatureRoutes = require("../routes/temperatureRoutes");

describe("virtual simulator HTTP telemetry transport", () => {
  let server;
  const app = express();
  app.use(express.json());
  app.use("/api/temperature", temperatureRoutes);

  const previousUrl = process.env.SIMULATOR_INGEST_URL;
  let capturedApiKey;
  app.post("/capture-edge-key", (_req, res) => {
    capturedApiKey = _req.get("x-api-key");
    res.json({ _id: "captured-gateway-key" });
  });

  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    process.env.SIMULATOR_INGEST_URL = `http://127.0.0.1:${server.address().port}/api/temperature/ingest`;
  });

  beforeEach(() => {
    delete process.env.SIMULATOR_INGEST_API_KEY;
    capturedApiKey = null;
    persistTemperatureLogs.mockReset().mockResolvedValue([{ _id: "saved-telemetry", sequenceNumber: 4 }]);
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    if (previousKey === undefined) delete process.env.TEMP_API_KEY;
    else process.env.TEMP_API_KEY = previousKey;
    if (previousSimulatorKey === undefined) delete process.env.SIMULATOR_INGEST_API_KEY;
    else process.env.SIMULATOR_INGEST_API_KEY = previousSimulatorKey;
    if (previousTransport === undefined) delete process.env.SIMULATOR_TRANSPORT;
    else process.env.SIMULATOR_TRANSPORT = previousTransport;
    if (previousUrl === undefined) delete process.env.SIMULATOR_INGEST_URL;
    else process.env.SIMULATOR_INGEST_URL = previousUrl;
  });

  test("POSTs a simulator tick with API-key auth and ingestion-compatible telemetry fields", async () => {
    const timestamp = recentTimestamp();
    const saved = await postSimulationReading({
      deviceId: "DEVICE-01",
      vehicleId: "TRUCK-01",
      batchId: "BATCH-01",
      shipmentId: "SHIPMENT-01",
      temperature: 9.5,
      humidity: 55,
      latitude: 9.93,
      longitude: 76.26,
      batteryLevel: 88,
      correlationId: "trace.http-6",
      timestamp,
      source: "manual-override",
      overrideId: "OVR-01",
      operatorUserId: "USER-01",
      simulation: {
        source: "software-iot-simulator",
        telemetrySource: "manual-override",
        scenario: "HIGH_TEMPERATURE",
        seed: 17,
        tick: 4,
      },
    });

    expect(saved).toEqual({ _id: "saved-telemetry", sequenceNumber: 4 });
    expect(persistTemperatureLogs).toHaveBeenCalledWith([expect.objectContaining({
      deviceId: "DEVICE-01",
      correlationId: "trace.http-6",
      sensorId: "DEVICE-01",
      vehicleId: "TRUCK-01",
      batchId: "BATCH-01",
      shipmentId: "SHIPMENT-01",
      sequenceNumber: 4,
      temperature: 9.5,
      status: "Normal",
      humidity: 55,
      batteryLevel: 88,
      recordedAt: new Date(timestamp),
      location: { lat: 9.93, lng: 76.26 },
      source: "manual-override",
      overrideId: "OVR-01",
      operatorUserId: "USER-01",
      simulation: expect.objectContaining({
        source: "software-iot-simulator",
        telemetrySource: "manual-override",
        seed: "17",
        tick: 4,
      }),
    })]);
  });

  test("fails the tick when the ingestion endpoint rejects it", async () => {
    process.env.TEMP_API_KEY = "wrong-test-key";
    await expect(postSimulationReading({ deviceId: "DEVICE-01" }))
      .rejects.toThrow("Simulator HTTP ingestion rejected the reading (HTTP 401)");
    process.env.TEMP_API_KEY = "test-simulator-ingestion-key";
  });

  test("requires the existing temperature API key", async () => {
    delete process.env.TEMP_API_KEY;
    await expect(postSimulationReading({ deviceId: "DEVICE-01" }))
      .rejects.toThrow("SIMULATOR_INGEST_API_KEY or TEMP_API_KEY must be configured for simulator HTTP ingestion");
    process.env.TEMP_API_KEY = "test-simulator-ingestion-key";
  });

  test("uses a separate Edge Gateway key when configured", async () => {
    const timestamp = recentTimestamp();
    process.env.SIMULATOR_INGEST_API_KEY = "test-edge-gateway-key";
    process.env.SIMULATOR_INGEST_URL = `http://127.0.0.1:${server.address().port}/capture-edge-key`;
    const response = await postSimulationReading({
      deviceId: "DEVICE-01", vehicleId: "TRUCK-01", batchId: "BATCH-01", temperature: 5,
      timestamp,
    });
    expect(response).toEqual({ _id: "captured-gateway-key" });
    expect(capturedApiKey).toBe("test-edge-gateway-key");
    expect(persistTemperatureLogs).not.toHaveBeenCalled();
    process.env.SIMULATOR_INGEST_URL = `http://127.0.0.1:${server.address().port}/api/temperature/ingest`;
  });

  test("rejects a remote HTTP endpoint so the API key is not sent in cleartext", () => {
    process.env.SIMULATOR_INGEST_URL = "http://example.test/api/temperature/ingest";
    expect(() => getIngestUrl()).toThrow("Remote simulator ingestion requires HTTPS");
    process.env.SIMULATOR_INGEST_URL = `http://127.0.0.1:${server.address().port}/api/temperature/ingest`;
  });
});
