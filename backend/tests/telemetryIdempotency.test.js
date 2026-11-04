const TemperatureLog = require("../models/TemperatureLog");
const LocationHistory = require("../models/LocationHistory");
const { persistTemperatureLogs, buildIdempotencyKey } = require("../services/telemetryService");
const { connect, close, fixture } = require("./helpers/coldChainFixture");

beforeAll(connect, 15000);
afterAll(close);

function sequencedReading(f, sequenceNumber) {
  const { timestamp, ...reading } = f.reading(5, 0);
  return {
    ...reading,
    location: { lat: reading.latitude, lng: reading.longitude },
    recordedAt: new Date(timestamp),
    sequenceNumber,
  };
}

test("TemperatureLog has a database-level unique idempotency-key index", async () => {
  const indexes = await TemperatureLog.collection.indexes();
  expect(indexes).toContainEqual(expect.objectContaining({
    name: "temperature_log_idempotency_key_unique",
    unique: true,
    sparse: true,
  }));
});

test("a normal sequenced sensor reading creates one temperature log", async () => {
  const f = await fixture();
  const [saved] = await persistTemperatureLogs([sequencedReading(f, 1)]);

  expect(saved.batchId).toBe(f.batchId);
  expect(saved.sequenceNumber).toBe(1);
  expect(await TemperatureLog.countDocuments({ batchId: f.batchId })).toBe(1);
  expect(await LocationHistory.findOne({ temperatureLogId: saved._id }).lean()).toMatchObject({
    batchId: f.batchId, shipmentId: f.shipmentId, sequenceNumber: 1,
    location: { lat: 9, lng: 76 },
  });
});

test("idempotency identity is device ID plus sequence, independent of timestamp and batch fields", async () => {
  expect(buildIdempotencyKey({ deviceId: "DEVICE-1", sequenceNumber: 42, batchId: "BATCH-A", recordedAt: new Date() }))
    .toBe(buildIdempotencyKey({ deviceId: "DEVICE-1", sequenceNumber: 42, batchId: "BATCH-B", recordedAt: new Date(Date.now() - 60000) }));
  expect(buildIdempotencyKey({ deviceId: "DEVICE-1", sequenceNumber: 43 })).not.toBe(buildIdempotencyKey({ deviceId: "DEVICE-1", sequenceNumber: 42 }));
  expect(buildIdempotencyKey({ deviceId: "DEVICE-2", sequenceNumber: 42 })).not.toBe(buildIdempotencyKey({ deviceId: "DEVICE-1", sequenceNumber: 42 }));
});

test("retrying the same device and sequence returns the existing log", async () => {
  const f = await fixture();
  const reading = sequencedReading(f, 4);
  const [first] = await persistTemperatureLogs([reading]);
  const [retry] = await persistTemperatureLogs([reading]);

  expect(String(retry._id)).toBe(String(first._id));
  expect(await TemperatureLog.countDocuments({ batchId: f.batchId })).toBe(1);
  expect(await LocationHistory.countDocuments({ temperatureLogId: first._id })).toBe(1);
});

test("retry after a post-insert processing failure resumes the existing log", async () => {
  const f = await fixture();
  const reading = sequencedReading(f, 6);
  const update = jest.spyOn(TemperatureLog, "updateOne").mockRejectedValueOnce(new Error("Injected post-insert failure"));

  await expect(persistTemperatureLogs([reading])).rejects.toThrow("Injected post-insert failure");
  const [writtenBeforeFailure] = await TemperatureLog.find({ batchId: f.batchId });
  expect(await TemperatureLog.countDocuments({ batchId: f.batchId })).toBe(1);
  update.mockRestore();

  const [retried] = await persistTemperatureLogs([reading]);
  expect(String(retried._id)).toBe(String(writtenBeforeFailure._id));
  expect(await TemperatureLog.countDocuments({ batchId: f.batchId })).toBe(1);
});

test("a different sequence number at the same timestamp creates a distinct log", async () => {
  const f = await fixture();
  const [first] = await persistTemperatureLogs([sequencedReading(f, 10)]);
  const [nextSequence] = await persistTemperatureLogs([sequencedReading(f, 11)]);

  expect(String(nextSequence._id)).not.toBe(String(first._id));
  expect(nextSequence.sequenceNumber).toBe(11);
  expect(await TemperatureLog.countDocuments({ batchId: f.batchId })).toBe(2);
});
