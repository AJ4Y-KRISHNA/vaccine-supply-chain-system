jest.mock("../services/telemetryService", () => ({
  persistTemperatureLogs: jest.fn(),
}));

const { persistTemperatureLogs } = require("../services/telemetryService");
const { ingestLog } = require("../controllers/temperatureController");

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}
const recentTimestamp = () => new Date(Date.now() - 60 * 1000).toISOString();

describe("temperature ingestion compatibility", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("accepts the existing minimal temperature ingestion payload", async () => {
    persistTemperatureLogs.mockResolvedValue([{ _id: "legacy-log", temperature: 5.2 }]);
    const res = response();

    await ingestLog(
      {
        body: {
          shipmentId: "SHIP-001",
          batchId: "VAC-001",
          sensorId: "SENSOR-01",
          temperature: 5.2,
          location: { lat: 9.9312, lng: 76.2673 },
        },
      },
      res
    );

    expect(persistTemperatureLogs).toHaveBeenCalledWith([
      expect.objectContaining({
        shipmentId: "SHIP-001",
        batchId: "VAC-001",
        sensorId: "SENSOR-01",
        temperature: 5.2,
      }),
    ]);
    expect(res.json).toHaveBeenCalledWith([{ _id: "legacy-log", temperature: 5.2 }]);
  });

  test("propagates the request correlation ID into every validated reading", async () => {
    persistTemperatureLogs.mockResolvedValue([{ _id: "traced-log" }]);
    const res = response();
    await ingestLog({ correlationId: "trace.temperature-1", body: [
      { batchId: "VAC-001", temperature: 5.2, correlationId: "trace.body-wrong" }, { batchId: "VAC-001", temperature: 5.4 },
    ] }, res);
    expect(persistTemperatureLogs).toHaveBeenCalledWith([
      expect.objectContaining({ correlationId: "trace.temperature-1", temperature: 5.2 }),
      expect.objectContaining({ correlationId: "trace.temperature-1", temperature: 5.4 }),
    ]);
  });

  test("accepts a sequence number for idempotent sensor ingestion", async () => {
    persistTemperatureLogs.mockResolvedValue([{ _id: "sequenced-log", temperature: 5.2 }]);
    const res = response();

    await ingestLog({ body: {
      batchId: "VAC-001",
      sensorId: "SENSOR-01",
      temperature: 5.2,
      recordedAt: recentTimestamp(),
      sequenceNumber: 7,
    } }, res);

    expect(persistTemperatureLogs).toHaveBeenCalledWith([
      expect.objectContaining({ sensorId: "SENSOR-01", sequenceNumber: 7 }),
    ]);
    expect(res.json).toHaveBeenCalledWith([{ _id: "sequenced-log", temperature: 5.2 }]);
  });

  test("accepts optional simulator provenance without changing the legacy contract", async () => {
    persistTemperatureLogs.mockResolvedValue([{ _id: "simulated-log", temperature: 9.5 }]);
    const res = response();
    const payload = {
      batchId: "VAC-001",
      shipmentId: "SHIP-001",
      deviceId: "DEVICE-01",
      sensorId: "DEVICE-01",
      vehicleId: "TRUCK-01",
      sequenceNumber: 4,
      source: "manual-override",
      overrideId: "OVR-01",
      operatorUserId: "USER-01",
      temperature: 9.5,
      humidity: 55,
      batteryLevel: 88,
      recordedAt: recentTimestamp(),
      location: { lat: 9.93, lng: 76.26 },
      simulation: {
        source: "software-iot-simulator",
        telemetrySource: "manual-override",
        overrideId: "OVR-01",
        operatorUserId: "USER-01",
        scenario: "HIGH_TEMPERATURE",
        seed: "demo-seed",
        tick: 4,
      },
    };

    await ingestLog({ body: payload }, res);

    expect(persistTemperatureLogs).toHaveBeenCalledWith([expect.objectContaining({
      source: "manual-override",
      overrideId: "OVR-01",
      operatorUserId: "USER-01",
      simulation: expect.objectContaining({ telemetrySource: "manual-override", tick: 4 }),
    })]);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith([{ _id: "simulated-log", temperature: 9.5 }]);
  });

  test("accepts explicit null override metadata emitted by an automatic simulator tick", async () => {
    persistTemperatureLogs.mockResolvedValue([{ _id: "automatic-log", temperature: 5.2 }]);
    const res = response();

    await ingestLog({ body: {
      batchId: "VAC-001", shipmentId: "SHIP-001", sensorId: "DEVICE-01", deviceId: "DEVICE-01",
      vehicleId: "TRUCK-01", sequenceNumber: 0, source: "auto-simulated", overrideId: null,
      operatorUserId: "USER-01", temperature: 5.2, humidity: 55, batteryLevel: 100,
      recordedAt: recentTimestamp(), location: { lat: 9.93, lng: 76.26 },
      simulation: { source: "software-iot-simulator", telemetrySource: "auto-simulated", overrideId: null,
        operatorUserId: "USER-01", scenario: "NORMAL", seed: "demo-seed", tick: 0 },
    } }, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(persistTemperatureLogs).toHaveBeenCalledWith([expect.objectContaining({
      source: "auto-simulated", overrideId: null, simulation: expect.objectContaining({ overrideId: null }),
    })]);
  });
});
