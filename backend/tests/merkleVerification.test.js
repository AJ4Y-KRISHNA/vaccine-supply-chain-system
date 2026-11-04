jest.mock("../services/blockchainService", () => ({ getBatchFromChain: jest.fn(), anchorSensorRoot: jest.fn(), getSensorRoot: jest.fn(), merkleAddress: () => "0x1234" }));
const db = require("./helpers/coldChainFixture"), Log = require("../models/TemperatureLog"), Leaf = require("../models/MerkleLeaf"), Window = require("../models/MerkleWindow");
const controller = require("../controllers/merkleVerificationController"), chain = require("../services/blockchainService"), merkle = require("../services/merkleAnchoring");
beforeAll(db.connect, 15000); afterAll(db.close, 15000);
beforeEach(async () => { await Promise.all([Log.deleteMany({}), Leaf.deleteMany({}), Window.deleteMany({})]); jest.clearAllMocks();
  chain.getBatchFromChain.mockResolvedValue({ batchId: "B", vaccineType: "Synthetic", quantity: 10 }); });
const request = (id, scope = {}) => ({ params: { batchId: "B", id }, scope: { telemetry: scope, distribution: {} } });
const response = () => { const res = { status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res; };
test("batch with no readings is verified but never claims sensor anchoring", async () => {
  const res = response(); await controller.verifyBatch(request(), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ verified: true, synthetic: true, sensorEvidenceAnchored: "no", historySummary: { count: 0 } }));
});
test("pending readings show summary and scoped individual endpoint never leaks another shipment", async () => {
  const row = await Log.create({ batchId: "B", shipmentId: "PRIVATE", temperature: 5 });
  const res = response(); await controller.verifyBatch(request(), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sensorEvidenceAnchored: "pending", historySummary: expect.objectContaining({ count: 1, mean: 5 }) }));
  const denied = response(); await controller.verifyReading(request(String(row._id), { shipmentId: "OTHER" }), denied);
  expect(denied.status).toHaveBeenCalledWith(404);
  const invalid = response(); await controller.verifyReading(request("bad"), invalid); expect(invalid.status).toHaveBeenCalledWith(400);
});
test("API returns proof and actual on-chain comparison and flags raw database tampering", async () => {
  const row = await Log.create({ batchId: "B", temperature: 5, recordedAt: new Date("2026-01-01"), isDemo: true });
  chain.anchorSensorRoot.mockResolvedValue({ chainId: 31337, contractAddress: "0x1234", gasUsed: "30000", gasPerReading: 30000 });
  chain.getSensorRoot.mockImplementation(async id => { const w = await Window.findOne({ windowId: id }); return { root: w.root, batchId: w.batchId, count: w.count,
    windowStart: +w.windowStart, windowEnd: +w.windowEnd, chainId: 31337 }; });
  await merkle.stage(row); await merkle.processOnce();
  const res = response(); await controller.verifyReading(request(String(row._id)), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ verified: true, proof: [], rootMatches: true, historySummary: expect.objectContaining({ count: 1 }) }));
  await Log.collection.updateOne({ _id: row._id }, { $set: { temperature: 40 } });
  const bad = response(); await controller.verifyBatch(request(), bad);
  expect(bad.json).toHaveBeenCalledWith(expect.objectContaining({ verified: true, sensorEvidenceAnchored: "no", integrityFailure: true }));
});
