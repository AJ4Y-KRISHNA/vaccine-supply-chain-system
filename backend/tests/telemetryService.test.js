jest.mock("../models/TemperatureLog", () => ({
  insertMany: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock("../services/temperatureAlertService", () => ({
  processSimulatedTemperatureReading: jest.fn(),
  checkMissingTelemetry: jest.fn().mockResolvedValue([]),
}));

jest.mock("../services/aiService", () => ({
  getTelemetryAnomaly: jest.fn(),
}));

jest.mock("../models/LocationHistory", () => ({ updateOne: jest.fn() }));
jest.mock("../models/Batch", () => ({ findOne: jest.fn() }));
jest.mock("../models/ColdChainPolicy", () => ({ findById: jest.fn() }));

const TemperatureLog = require("../models/TemperatureLog");
const LocationHistory = require("../models/LocationHistory");
const Batch = require("../models/Batch");
const { processSimulatedTemperatureReading } = require("../services/temperatureAlertService");
const { getTelemetryAnomaly } = require("../services/aiService");
const {
  persistSimulationReading,
  simulationReadingToTemperatureLog,
} = require("../services/telemetryService");

const reading = {
  deviceId: "IOT-001",
  vehicleId: "TRUCK-01",
  batchId: "VAC-001",
  shipmentId: "SHIP-001",
  temperature: 5.2,
  humidity: 58,
  latitude: 9.9312,
  longitude: 76.2673,
  batteryLevel: 92,
  timestamp: "2026-09-17T10:30:00.000Z",
  correlationId: "trace.persist-3",
  simulation: {
    source: "software-iot-simulator",
    scenario: "NORMAL",
    seed: "1",
    tick: 0,
  },
};

describe("telemetry persistence", () => {
  beforeEach(() => {
    processSimulatedTemperatureReading.mockResolvedValue({ evaluated: false, policyStatus: "POLICY_NOT_CONFIGURED" });
    getTelemetryAnomaly.mockResolvedValue({ status: "INSUFFICIENT_HISTORY", is_anomaly: false, advisory_only: true, reason: "Need baseline" });
    LocationHistory.updateOne.mockResolvedValue({ acknowledged: true, upsertedCount: 1 });
    Batch.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("maps and persists a simulator reading in the existing TemperatureLog collection", async () => {
    const mapped = simulationReadingToTemperatureLog(reading);
    TemperatureLog.findOneAndUpdate.mockResolvedValue({ _id: "log-1", ...mapped });

    const persisted = await persistSimulationReading(reading);

    expect(TemperatureLog.findOneAndUpdate).toHaveBeenCalledWith(
      { idempotencyKey: expect.stringMatching(/^v2:/) },
      { $setOnInsert: expect.objectContaining({
        shipmentId: "SHIP-001",
        batchId: "VAC-001",
        sensorId: "IOT-001",
        deviceId: "IOT-001",
        vehicleId: "TRUCK-01",
        sequenceNumber: 0,
        correlationId: "trace.persist-3",
        location: { lat: 9.9312, lng: 76.2673 },
        simulation: expect.objectContaining({ source: "software-iot-simulator" }),
        idempotencyKey: expect.stringMatching(/^v2:/),
      }) },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    expect(persisted._id).toBe("log-1");
    expect(LocationHistory.updateOne).toHaveBeenCalledWith({ temperatureLogId: "log-1" }, expect.any(Object),
      { upsert: true, setDefaultsOnInsert: true });
  });

  test("marks a simulator temperature log as Alert only after backend detection", async () => {
    TemperatureLog.findOneAndUpdate.mockResolvedValue({ _id: "log-2", ...simulationReadingToTemperatureLog(reading) });
    processSimulatedTemperatureReading.mockResolvedValue({
      evaluated: true,
      violationType: "HIGH_TEMPERATURE",
      severity: "WARNING",
    });

    const persisted = await persistSimulationReading(reading);

    expect(getTelemetryAnomaly).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "trace.persist-3" }));
    expect(processSimulatedTemperatureReading).toHaveBeenCalledWith(expect.objectContaining({ deviceId: reading.deviceId, timestamp: new Date(reading.timestamp),
      correlationId: "trace.persist-3",
      anomalyInference: expect.objectContaining({ status: "INSUFFICIENT_HISTORY", advisory_only: true }) }), "log-2");
    expect(TemperatureLog.updateOne).toHaveBeenCalledWith(
      { _id: "log-2" },
      { $set: { status: "Alert", evaluation: expect.objectContaining({ evaluated: true,
        anomalyInference: expect.objectContaining({ status: "INSUFFICIENT_HISTORY", advisory_only: true }) }) } }
    );
    expect(persisted.status).toBe("Alert");
    expect(persisted.evaluation.anomalyInference.reason).toBe("Need baseline");
  });
});
