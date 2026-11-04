jest.mock("../services/eventBackbone", () => ({ enabled: () => true, publish: jest.fn(async rows => rows.map(row => ({
  ...row, accepted: true, processingStatus: "QUEUED", eventId: "synthetic-event-id",
}))) }));
const backbone = require("../services/eventBackbone");
const { ingestTelemetryPayload } = require("../controllers/temperatureController");
beforeEach(() => jest.clearAllMocks());
test("validates before stream publish and preserves correlation in receipt", async () => {
  const receipt = await ingestTelemetryPayload({ deviceId: "synthetic-device", sequenceNumber: 7,
    temperature: 5, humidity: 60, batteryLevel: 90 }, { correlationId: "trace.accepted.7" });
  expect(receipt[0]).toMatchObject({ accepted: true, processingStatus: "QUEUED", correlationId: "trace.accepted.7" });
  expect(backbone.publish).toHaveBeenCalledWith([expect.objectContaining({ recordedAt: expect.any(Date), correlationId: "trace.accepted.7" })]);
});
test("manual provenance survives validation into the accepted stream event", async () => {
  await ingestTelemetryPayload({ batchId: "SYNTHETIC-BATCH", shipmentId: "SYNTHETIC-SHIP",
    deviceId: "manual-device", vehicleId: "TRUCK-1", sequenceNumber: 8, temperature: 11,
    humidity: 58, batteryLevel: 90, location: { lat: 9.9, lng: 76.2 },
    recordedAt: new Date(Date.now() - 60_000), source: "manual", enteredBy: "operator-1",
    note: "Synthetic operator entry", needsReview: true }, { correlationId: "trace.manual.8" });
  expect(backbone.publish).toHaveBeenCalledWith([expect.objectContaining({
    source: "manual", enteredBy: "operator-1", note: "Synthetic operator entry", needsReview: true,
    correlationId: "trace.manual.8",
  })]);
});
test("invalid sensor values never enter Redis accepted stream", async () => {
  await expect(ingestTelemetryPayload({ temperature: 61 })).rejects.toMatchObject({ status: 400 });
  expect(backbone.publish).not.toHaveBeenCalled();
});
