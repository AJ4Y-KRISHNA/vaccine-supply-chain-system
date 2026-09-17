jest.mock("../services/blockchainService", () => ({ anchorAuditOnChain: jest.fn(), verifyAuditOnChain: jest.fn() }));
const db = require("./helpers/coldChainFixture");
const Audit = require("../models/ColdChainAudit");
const Anchor = require("../models/AuditAnchor");
const chain = require("../services/blockchainService");
const service = require("../services/auditAnchoring");
beforeAll(db.connect); afterAll(db.close);
beforeEach(async () => { await Audit.collection.deleteMany({}); await Anchor.deleteMany({}); jest.clearAllMocks(); });
const record = () => Audit.create({ batchId: "DEMO-B", action: "QUARANTINED", actorId: "SYSTEM", reason: "Synthetic evidence", eventTime: new Date("2026-01-01"), snapshot: { temperature: 10, humidity: 60 } });
test("canonical evidence is key-order stable and detects tampering", async () => {
  const row = (await record()).toObject();
  expect(service.evidence(row)).toEqual(service.evidence({ ...row, snapshot: { humidity: 60, temperature: 10 } }));
  expect(service.evidence(row).digest).not.toBe(service.evidence({ ...row, reason: "Changed" }).digest);
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
