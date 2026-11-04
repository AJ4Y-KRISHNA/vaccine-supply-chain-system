jest.mock("../services/blockchainService", () => ({
  assertBatchCreationReady: jest.fn(), registerBatchOnChain: jest.fn(), mintInventoryCertificateOnChain: jest.fn(),
  approveBatchReleaseOnChain: jest.fn(), logLifecycleEventOnChain: jest.fn(), updateBatchStatusOnChain: jest.fn(),
  extractHash: receipt => receipt?.hash || "",
}));
jest.mock("../services/aiService", () => ({ getForecast: jest.fn().mockResolvedValue({ predicted_demand: 0 }) }));
const express = require("express");
const request = require("supertest");
const { connect, close } = require("./helpers/coldChainFixture");
const { issueToken } = require("../middleware/auth");
const User = require("../models/user");
const Batch = require("../models/Batch");
const RawMaterial = require("../models/RawMaterial");
const Production = require("../models/Production");
const BatchReport = require("../models/BatchReport");
const chain = require("../services/blockchainService");
const app = express(); app.use(express.json());
app.use("/api/manufacturer", require("../routes/manufacturerRoutes"));
app.use("/api/dashboard", require("../routes/dashboardRoutes"));
let maker, hospital, index = 0;
const auth = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });
const input = () => ({ batchId: `CREATE-TEST-${++index}`, vaccineType: "SYNTHETIC classroom product", quantity: 100,
  supplier: "Synthetic Supplier", materialType: "Synthetic Material", materialQuantity: 100, unit: "test units",
  expiresAt: "2099-12-31T00:00:00.000Z", remarks: "Not clinical inventory" });
const create = (body, user = maker) => request(app).post("/api/manufacturer/workflow").set(auth(user)).send(body);
beforeAll(async () => {
  await connect();
  maker = await User.create({ email: "create-maker@example.test", role: "manufacturer", manufacturer: "Synthetic Maker" });
  hospital = await User.create({ email: "create-hospital@example.test", role: "healthcare", hospital: "Synthetic Hospital" });
}, 15000);
afterAll(close);
beforeEach(() => {
  jest.resetAllMocks();
  chain.assertBatchCreationReady.mockResolvedValue(undefined);
  for (const name of ["registerBatchOnChain", "mintInventoryCertificateOnChain", "approveBatchReleaseOnChain", "logLifecycleEventOnChain", "updateBatchStatusOnChain"])
    chain[name].mockResolvedValue({ hash: `0x${"a".repeat(64)}`, status: 1 });
});

test("creates the full workflow with account ownership, expiry and no automatic release", async () => {
  const body = input();
  const res = await create(body);
  expect(res.status).toBe(200);
  expect(res.body.batch).toMatchObject({ batchId: body.batchId, quantity: 100, manufacturer: maker.manufacturer,
    expiresAt: body.expiresAt, productionApproved: false, labApproved: false, releaseVisibleToExternal: false, reportStatus: "Reported" });
  expect(await RawMaterial.countDocuments({ batchId: body.batchId })).toBe(1);
  expect(await Production.countDocuments({ batchId: body.batchId })).toBe(1);
  expect(await BatchReport.countDocuments({ batchId: body.batchId })).toBe(1);
  expect(chain.approveBatchReleaseOnChain).not.toHaveBeenCalled();
  const dashboard = await request(app).get("/api/dashboard/manufacturer").set(auth(maker));
  expect(dashboard.body.identity.manufacturer).toBe(maker.manufacturer);
  expect(dashboard.body.batches.find(b => b.batchId === body.batchId).expiresAt).toBe(body.expiresAt);
});

test.each([
  { quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: Number.MAX_SAFE_INTEGER + 1 },
  { materialQuantity: 0 }, { materialQuantity: 2.5 }, { vaccineType: "   " }, { supplier: " " },
  { expiresAt: "2020-01-01T00:00:00Z" }, { expiresAt: "not-a-date" }, { remarks: "a".repeat(2001) },
])("rejects invalid input before any operational write: %j", async invalid => {
  const body = { ...input(), ...invalid };
  expect((await create(body)).status).toBe(400);
  expect(await RawMaterial.countDocuments({ batchId: body.batchId })).toBe(0);
  expect(await Batch.countDocuments({ batchId: body.batchId })).toBe(0);
  expect(chain.assertBatchCreationReady).not.toHaveBeenCalled();
});

test("retains optional legacy defaults and accepts numeric input strings", async () => {
  const body = { batchId: input().batchId, vaccineType: "Legacy synthetic product", quantity: "10" };
  const res = await create(body);
  expect(res.status).toBe(200);
  expect(res.body.batch.quantity).toBe(10);
  expect(res.body.rawMaterial.quantity).toBe(10);
});

test("canonical duplicate and concurrent submissions cannot create a second workflow", async () => {
  const body = input();
  const results = await Promise.all([create(body), create({ ...body, batchId: `  ${body.batchId}  ` })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  expect(await Batch.countDocuments({ batchId: body.batchId })).toBe(1);
  expect(await RawMaterial.countDocuments({ batchId: body.batchId })).toBe(1);
  expect(chain.registerBatchOnChain).toHaveBeenCalledTimes(1);
});

test("rejects anonymous, wrong-role, owner spoofing and protected-field inputs", async () => {
  const body = input();
  expect((await request(app).post("/api/manufacturer/workflow").send(body)).status).toBe(401);
  expect((await create(body, hospital)).status).toBe(403);
  expect((await create({ ...body, manufacturer: "Someone else" })).status).toBe(403);
  expect((await create({ ...body, releaseVisibleToExternal: true })).status).toBe(400);
  expect(await RawMaterial.countDocuments({ batchId: body.batchId })).toBe(0);
});

test("preserves hold precedence over creation/validation", async () => {
  const body = input();
  await Batch.create({ ...body, manufacturer: maker.manufacturer, coldChainHoldAlertIds: ["TEST-HOLD"] });
  const res = await create({ batchId: body.batchId });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe("COLD_CHAIN_HOLD");
  expect(chain.assertBatchCreationReady).not.toHaveBeenCalled();
});

test.each([[503, "BLOCKCHAIN_NOT_READY"], [409, "CHAIN_BATCH_EXISTS"]])("preflight failure %s leaves no records", async (status, code) => {
  const body = input();
  chain.assertBatchCreationReady.mockRejectedValueOnce(Object.assign(new Error("Local chain unavailable or ID already registered"), { status, code }));
  const res = await create(body);
  expect(res.status).toBe(status);
  expect(res.body.code).toBe(code);
  expect(await RawMaterial.countDocuments({ batchId: body.batchId })).toBe(0);
  expect(await Batch.countDocuments({ batchId: body.batchId })).toBe(0);
});

test("partial-write failure is explicit and a retry does not duplicate early records", async () => {
  const body = input();
  chain.logLifecycleEventOnChain.mockRejectedValueOnce(new Error("Disconnected after request"));
  const first = await create(body);
  expect(first.status).toBe(500);
  expect(first.body.code).toBe("MANUFACTURING_INCOMPLETE");
  expect((await create(body)).status).toBe(409);
  expect(await RawMaterial.countDocuments({ batchId: body.batchId })).toBe(1);
  expect(await Batch.countDocuments({ batchId: body.batchId })).toBe(0);
});

test("registration failure is not reported as a successful creation", async () => {
  const body = input();
  chain.registerBatchOnChain.mockRejectedValueOnce(new Error("Registration reverted"));
  const res = await create(body);
  expect(res.status).toBe(500);
  expect(res.body.code).toBe("MANUFACTURING_INCOMPLETE");
  expect((await Batch.findOne({ batchId: body.batchId })).releaseVisibleToExternal).toBe(false);
  expect(await BatchReport.countDocuments({ batchId: body.batchId })).toBe(0);
});

test("unconfirmed certificate is labeled instead of claiming it was minted", async () => {
  const body = input();
  chain.mintInventoryCertificateOnChain.mockRejectedValueOnce(new Error("Certificate unavailable"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const res = await create(body);
    expect(res.status).toBe(200);
    expect(res.body.batch.certificateMinted).toBe(false);
    expect(res.body.warnings).toHaveLength(1);
  } finally { warn.mockRestore(); }
});
