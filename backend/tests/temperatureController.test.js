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
});
