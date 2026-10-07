jest.mock("../services/blockchainService", () => ({ anchorSensorRoot: jest.fn(), getSensorRoot: jest.fn(), merkleAddress: () => "0x1234" }));
const db = require("./helpers/coldChainFixture"), Log = require("../models/TemperatureLog");
const Leaf = require("../models/MerkleLeaf"), Window = require("../models/MerkleWindow");
const tree = require("../services/merkleTree"), service = require("../services/merkleAnchoring"), chain = require("../services/blockchainService");
beforeAll(db.connect, 15000); afterAll(db.close, 15000);
beforeEach(async () => { await Promise.all([Log.deleteMany({}), Leaf.deleteMany({}), Window.deleteMany({})]); jest.clearAllMocks();
  chain.anchorSensorRoot.mockImplementation(async row => ({ chainId: 31337, contractAddress: "0x1234", gasUsed: "30000", gasPerReading: 30000 / row.count }));
  chain.getSensorRoot.mockImplementation(async id => { const row = await Window.findOne({ windowId: id });
    return { root: row.root, batchId: row.batchId, count: row.count, windowStart: +row.windowStart, windowEnd: +row.windowEnd, chainId: 31337 }; });
});
const record = (extra = {}) => Log.create({ batchId: "SYNTHETIC-B", deviceId: "SENSOR", temperature: 5,
  recordedAt: new Date("2026-01-01T00:01:00Z"), isDemo: true, ...extra });
test("domain-separated Merkle proofs handle odd/single leaves and reject changes", () => {
  const leaves = [1, 2, 3].map(n => tree.leafHash({ _id: String(n), temperature: n })), built = tree.build(leaves);
  leaves.forEach((leaf, i) => expect(tree.verify(leaf, built.proofs[i], built.root)).toBe(true));
  expect(tree.verify(tree.leafHash({ _id: "1", temperature: 99 }), built.proofs[0], built.root)).toBe(false);
  expect(tree.build([leaves[0]]).proofs).toEqual([[]]);
});
test("Merkle bucket duration defaults to 300 seconds and honors the demo window setting", () => {
  const prior = process.env.MERKLE_WINDOW_SECONDS;
  try {
    delete process.env.MERKLE_WINDOW_SECONDS;
    expect(service.windowSeconds()).toBe(300);
    process.env.MERKLE_WINDOW_SECONDS = "30";
    expect(service.windowMilliseconds()).toBe(30000);
    process.env.MERKLE_WINDOW_SECONDS = "0";
    expect(service.windowSeconds()).toBe(300);
  } finally {
    if (prior === undefined) delete process.env.MERKLE_WINDOW_SECONDS;
    else process.env.MERKLE_WINDOW_SECONDS = prior;
  }
});
test("five-minute collecting window is pending then anchors once, including gas metrics", async () => {
  const prior = process.env.MERKLE_WINDOW_SECONDS;
  process.env.MERKLE_WINDOW_SECONDS = "300";
  try {
    const row = await record(); await service.stage(row); await service.stage(row);
    expect(await Leaf.countDocuments()).toBe(1);
    await service.processOnce({ now: new Date("2026-01-01T00:04:00Z") });
    expect(chain.anchorSensorRoot).not.toHaveBeenCalled();
    expect((await service.verifyReading(row)).anchored).toBe("pending");
    await expect(service.processOnce({ now: new Date("2026-01-01T00:05:00Z") })).resolves.toMatchObject({ confirmed: 1, failed: 0 });
    expect(await service.verifyReading(row)).toMatchObject({ verified: true, anchored: "yes", gasUsed: "30000", gasPerReading: 30000 });
    await service.processOnce(); expect(chain.anchorSensorRoot).toHaveBeenCalledTimes(1);
  } finally {
    if (prior === undefined) delete process.env.MERKLE_WINDOW_SECONDS;
    else process.env.MERKLE_WINDOW_SECONDS = prior;
  }
});
test("100 readings close a window early and retain unique off-chain proofs", async () => {
  const rows = await Log.insertMany(Array.from({ length: 100 }, (_, i) => ({ batchId: "SYNTHETIC-B", temperature: 5, sequenceNumber: i, recordedAt: new Date("2026-01-01T00:01:00Z") })));
  for (const row of rows) await service.stage(row);
  await service.processOnce({ now: new Date("2026-01-01T00:02:00Z") });
  expect(await Window.countDocuments({ count: 100, status: "confirmed" })).toBe(1);
  expect((await service.verifyReading(rows[41])).verified).toBe(true);
});
test("outage retry preserves snapshot; changing one stored reading fails verification", async () => {
  const row = await record(); await service.stage(row);
  chain.anchorSensorRoot.mockRejectedValueOnce(new Error("offline"));
  expect((await service.processOnce()).failed).toBe(1);
  const before = await Window.findOne().lean();
  expect((await service.processOnce({ forceRetry: true })).confirmed).toBe(1);
  expect((await Window.findOne()).root).toBe(before.root);
  await Log.collection.updateOne({ _id: row._id }, { $set: { temperature: 12.5 } });
  expect(await service.verifyReading(await Log.findById(row._id))).toMatchObject({ verified: false, tampered: true, anchored: "no" });
  await expect(service.stage(await Log.findById(row._id))).rejects.toThrow("changed");
});
test("mutable AI output does not invalidate raw evidence, but a false root or contract does", async () => {
  const row = await record(); await service.stage(row); await service.processOnce();
  row.evaluation = { anomaly: true }; row.status = "Alert"; await row.save();
  expect((await service.verifyReading(row)).verified).toBe(true);
  chain.getSensorRoot.mockResolvedValue({ root: "0x" + "a".repeat(64), chainId: 31337 });
  expect((await service.verifyReading(row)).verified).toBe(false);
  await Window.updateOne({}, { contractAddress: "0x5678" });
  expect((await service.verifyReading(row)).tampered).toBe(true);
});
test("anchoring consumer acknowledges durable staging even while the chain is offline", async () => {
  const Receipt = require("../models/EventReceipt");
  const row = await record(); const event = { eventId: "merkle-stage-event", correlationId: "trace-merkle", reading: { _id: row._id } };
  await Receipt.create({ eventId: event.eventId, group: "persistence", readingId: row._id });
  await Receipt.create({ eventId: event.eventId, group: "policy-alert" });
  process.env.AUDIT_ANCHOR_ENABLED = "true"; process.env.TELEMETRY_ANCHOR_MODE = "merkle";
  try {
    await require("../services/eventConsumers").anchoring(event);
    await require("../services/eventConsumers").anchoring(event);
    expect(await Receipt.countDocuments({ eventId: event.eventId, group: "anchoring" })).toBe(1);
    expect(await Leaf.countDocuments({ readingId: row._id })).toBe(1);
    expect(chain.anchorSensorRoot).not.toHaveBeenCalled();
    chain.anchorSensorRoot.mockRejectedValueOnce(new Error("chain stopped"));
    expect((await service.processOnce()).failed).toBe(1);
    expect((await service.processOnce({ forceRetry: true })).confirmed).toBe(1);
  } finally { delete process.env.AUDIT_ANCHOR_ENABLED; delete process.env.TELEMETRY_ANCHOR_MODE; }
});
test("batches never mix, and late arrivals do not rewrite a confirmed window", async () => {
  const first = await record(), other = await record({ batchId: "SYNTHETIC-C" });
  await service.stage(first); await service.stage(other); await service.processOnce();
  expect(await Window.countDocuments({ status: "confirmed" })).toBe(2);
  const oldRoot = (await Window.findOne({ batchId: "SYNTHETIC-B" })).root;
  const late = await record({ temperature: 6 }); await service.stage(late); await service.processOnce();
  expect(await Window.countDocuments({ batchId: "SYNTHETIC-B" })).toBe(2);
  expect(await Window.exists({ root: oldRoot })).toBeTruthy();
  expect((await service.verifyReading(first)).verified).toBe(true);
});
