jest.mock("../services/blockchainService", () => ({ anchorAuditOnChain: jest.fn(), verifyAuditOnChain: jest.fn(),
  prepareTemperatureReading: jest.fn(reading => ({ digest: "0x" + "c".repeat(64), recordId: reading.recordId })),
  recordTemperatureReadingOnChain: jest.fn(), verifyTemperatureReadingOnChain: jest.fn() }));
const db = require("./helpers/coldChainFixture");
const Audit = require("../models/ColdChainAudit");
const Anchor = require("../models/AuditAnchor");
const TemperatureLog = require("../models/TemperatureLog");
const TelemetryAnchor = require("../models/TelemetryAnchor");
const chain = require("../services/blockchainService");
const service = require("../services/auditAnchoring");
beforeAll(() => { process.env.TELEMETRY_ANCHOR_MODE = "legacy"; return db.connect(); });
afterAll(async () => { delete process.env.TELEMETRY_ANCHOR_MODE; await db.close(); });
beforeEach(async () => { await Audit.collection.deleteMany({}); await Anchor.deleteMany({}); await TemperatureLog.deleteMany({}); await TelemetryAnchor.deleteMany({}); jest.clearAllMocks(); });
const record = () => Audit.create({ batchId: "DEMO-B", action: "QUARANTINED", actorId: "SYSTEM", reason: "Synthetic evidence", eventTime: new Date("2026-01-01"), snapshot: { temperature: 10, humidity: 60 } });
test("canonical evidence is key-order stable and detects tampering", async () => {
  const row = (await record()).toObject();
  expect(service.evidence(row)).toEqual(service.evidence({ ...row, snapshot: { humidity: 60, temperature: 10 } }));
  expect(service.evidence(row).digest).not.toBe(service.evidence({ ...row, reason: "Changed" }).digest);
});
test("telemetry digest covers sensor evidence but excludes mutable evaluation output", () => {
  const reading = { _id: "reading-1", batchId: "DEMO-B", temperature: 5, humidity: 50,
    correlationId: "trace.anchor-4", recordedAt: new Date("2026-01-01T00:00:00Z"), status: "Normal", evaluation: { phase: "NORMAL" } };
  expect(service.telemetryEvidence(reading).digest).toBe(service.telemetryEvidence({ ...reading, status: "Alert", evaluation: { phase: "QUARANTINED" } }).digest);
  expect(service.telemetryEvidence(reading).digest).not.toBe(service.telemetryEvidence({ ...reading, temperature: 9 }).digest);
  expect(service.telemetryEvidence(reading).digest).not.toBe(service.telemetryEvidence({ ...reading, correlationId: "trace.anchor-5" }).digest);
});
test("outbox retries failure, resumes after restart and verifies rather than trusting a saved flag", async () => {
  process.env.CONTRACT_ADDRESS = "0x1234";
  await record(); chain.anchorAuditOnChain.mockRejectedValueOnce(new Error("offline"));
  expect(await service.processOnce()).toEqual({ confirmed: 0, failed: 1 });
  chain.anchorAuditOnChain.mockResolvedValue({ txHash: "0x" + "a".repeat(64), chainId: 31337, contractAddress: "0x1234" });
  expect(await service.processOnce()).toEqual({ confirmed: 1, failed: 0 });
  expect(await service.processOnce()).toEqual({ confirmed: 0, failed: 0 });
  chain.verifyAuditOnChain.mockResolvedValue(true);
  expect((await service.inspectBatch("DEMO-B"))[0].verified).toBe(true);
  chain.verifyAuditOnChain.mockResolvedValue(false);
  expect((await service.inspectBatch("DEMO-B"))[0].verified).toBe(false);
  expect(await Audit.countDocuments()).toBe(1);
});
test("queued evidence cannot be silently replaced after a failed send", async () => {
  const row = await record(); chain.anchorAuditOnChain.mockRejectedValue(new Error("offline"));
  await service.processOnce();
  await Audit.collection.updateOne({ _id: row._id }, { $set: { reason: "Direct DB tamper" } });
  chain.anchorAuditOnChain.mockClear();
  expect(await service.processOnce()).toEqual({ confirmed: 0, failed: 1 });
  expect(chain.anchorAuditOnChain).not.toHaveBeenCalled();
});

test("each persisted temperature reading is anchored by digest and reverified against the local chain", async () => {
  process.env.CONTRACT_ADDRESS = "0x1234";
  const reading = await TemperatureLog.create({ batchId: "DEMO-B", shipmentId: "SHIP-B", deviceId: "DEVICE-B",
    temperature: 7.2, humidity: 55, batteryLevel: 93, recordedAt: new Date("2026-01-01T00:01:00Z"),
    location: { lat: 9.9, lng: 76.2 }, status: "Normal" });
  chain.anchorAuditOnChain.mockResolvedValue({ txHash: "0x" + "b".repeat(64), chainId: 31337, contractAddress: "0x1234" });
  chain.recordTemperatureReadingOnChain.mockResolvedValue({ txHash: "0x" + "c".repeat(64), chainId: 31337, contractAddress: "0x1234" });
  expect(await service.processOnce()).toEqual({ confirmed: 1, failed: 0 });
  const anchor = await TelemetryAnchor.findOne({ readingId: reading._id }).lean();
  expect(anchor).toMatchObject({ batchId: "DEMO-B", status: "confirmed", chainId: 31337, contractAddress: "0x1234" });
  expect(anchor.digest).toMatch(/^0x[0-9a-f]{64}$/);
  expect(anchor.digest).not.toContain("7.2");
  chain.verifyAuditOnChain.mockResolvedValue(true);
  chain.verifyTemperatureReadingOnChain.mockResolvedValue({ batchId: "DEMO-B", temperature: 7.2 });
  const [entry] = await service.inspectBatch("DEMO-B");
  expect(entry).toMatchObject({ kind: "temperature-reading", recordId: reading._id, verified: true, anchor: { status: "confirmed" } });
  expect(entry.rawChain).toMatchObject({ status: "confirmed", verified: true, reading: { temperature: 7.2 } });
  expect(entry).not.toHaveProperty("temperature");
});

test("raw full-reading writes retry independently after the digest has already been anchored", async () => {
  process.env.CONTRACT_ADDRESS = "0x1234";
  await TemperatureLog.create({ batchId: "DEMO-B", temperature: 5, recordedAt: new Date("2026-01-01T00:01:00Z") });
  chain.anchorAuditOnChain.mockResolvedValue({ txHash: "0x" + "d".repeat(64), chainId: 31337, contractAddress: "0x1234" });
  chain.recordTemperatureReadingOnChain.mockRejectedValueOnce(new Error("temporary local chain outage"))
    .mockResolvedValue({ txHash: "0x" + "e".repeat(64), chainId: 31337, contractAddress: "0x1234" });
  expect(await service.processOnce()).toEqual({ confirmed: 0, failed: 1 });
  expect(await TelemetryAnchor.findOne({ batchId: "DEMO-B" }).lean()).toMatchObject({ status: "confirmed", rawChainStatus: "failed" });
  expect(await service.processOnce()).toEqual({ confirmed: 1, failed: 0 });
  expect(chain.anchorAuditOnChain).toHaveBeenCalledTimes(1);
  expect(chain.recordTemperatureReadingOnChain).toHaveBeenCalledTimes(2);
  expect(await TelemetryAnchor.findOne({ batchId: "DEMO-B" }).lean()).toMatchObject({ status: "confirmed", rawChainStatus: "confirmed" });
});

test("a changed temperature record cannot silently reuse a failed history digest", async () => {
  const reading = await TemperatureLog.create({ batchId: "DEMO-B", temperature: 5, recordedAt: new Date("2026-01-01T00:01:00Z") });
  chain.anchorAuditOnChain.mockRejectedValueOnce(new Error("offline"));
  expect(await service.processOnce()).toEqual({ confirmed: 0, failed: 1 });
  await TemperatureLog.collection.updateOne({ _id: reading._id }, { $set: { temperature: 6 } });
  chain.anchorAuditOnChain.mockClear();
  expect(await service.processOnce()).toEqual({ confirmed: 0, failed: 1 });
  expect(chain.anchorAuditOnChain).not.toHaveBeenCalled();
});
