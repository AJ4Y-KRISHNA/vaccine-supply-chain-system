jest.mock("../services/aiService", () => ({ getRegionalForecast: jest.fn(), getForecastAllocation: jest.fn() }));
const express = require("express"), request = require("supertest");
const mongoose = require("mongoose");
const User = require("../models/user"), Batch = require("../models/Batch"), Order = require("../models/Order");
const ForecastRun = require("../models/ForecastRun"), Approval = require("../models/ForecastPlanApproval");
const ai = require("../services/aiService");
const { buildSyntheticOrderHistory } = require("../scripts/seed");
const { issueToken } = require("../middleware/auth");
const { connect, close } = require("./helpers/coldChainFixture");
const app = express(); app.use(express.json());
app.use("/api/forecast", require("../routes/forecastRoutes")); app.use("/api/admin", require("../routes/adminRoutes"));
const bearer = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });
let admin, maker, other, dist;
beforeAll(connect, 15000); afterAll(close);
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Order.deleteMany({}), Batch.deleteMany({})]);
  [admin, maker, other, dist] = await User.create([
    { email: "a@test", role: "admin" }, { email: "m@test", role: "manufacturer", manufacturer: "Synthetic Demo Manufacturer" },
    { email: "o@test", role: "manufacturer", manufacturer: "other" }, { email: "d@test", role: "distributor" },
  ]);
  await Order.insertMany(buildSyntheticOrderHistory(), { timestamps: false });
  ai.getRegionalForecast.mockResolvedValue({ model: "seasonal_naive_12", history: [100], forecast_periods: [
    { period: new Date().toISOString().slice(0, 7), demand_doses: 120, lower: 90, upper: 150 }], comparison: [{ model: "seasonal_naive_12", rmse: 10, mape: 5 }], limitations: [] });
  ai.getForecastAllocation.mockImplementation(async ({ inventory, demand }) => ({ allocatedDoses: inventory.length ? 120 : 0,
    allocations: [], unfilled: demand, assumptions: [], method: "test-solver" }));
});
test("seeded product-region catalog is scoped, complete months only and has no physical allocation fiction", async () => {
  const result = await request(app).get("/api/forecast").set(bearer(maker));
  expect(result.status).toBe(200); expect(result.body.catalog).toHaveLength(3);
  expect(result.body.catalog[0]).toMatchObject({ months: 35, ready: true });
  expect((await request(app).get("/api/forecast").set(bearer(other))).body.catalog).toEqual([]);
  expect((await request(app).get("/api/forecast").set(bearer(dist))).status).toBe(403);
});
test("forecast saves provenance, provides account-scoped JSON and rejects invalid horizons", async () => {
  const result = await request(app).get("/api/forecast").query({ vaccineType: "Synthetic Vaccine A", region: "Synthetic Demo Region", horizon: 3 }).set(bearer(admin));
  expect(result.status).toBe(200); expect(result.body.forecast.provenance).toMatchObject({ synthetic: true, observation_count: 35 });
  expect(await ForecastRun.exists({ _id: result.body.runId })).toBeTruthy();
  expect((await request(app).get(`/api/forecast/${result.body.runId}/metrics`).set(bearer(admin))).body.synthetic).toBe(true);
  expect((await request(app).get(`/api/forecast/${result.body.runId}/metrics`).set(bearer(maker))).status).toBe(404);
  expect((await request(app).get("/api/forecast").query({ vaccineType: "Synthetic Vaccine A", region: "Synthetic Demo Region", horizon: 2 }).set(bearer(admin))).status).toBe(400);
});
test("review approval is admin-only, immutable, idempotent and never mutates stock; stale inventory blocks approval", async () => {
  const run = await ForecastRun.create({ createdBy: admin._id, vaccineType: "Synthetic Vaccine A", region: "R", result: await ai.getRegionalForecast() });
  const inputs = { runIds: [String(run._id)], destinationCapacity: 500, transportCapacity: 500, minimumShelfLifeDays: 30 };
  const plan = await request(app).post("/api/admin/forecast-plan").set(bearer(admin)).send(inputs);
  expect(plan.status).toBe(201); expect(plan.body.allocatedDoses).toBe(0);
  const url = `/api/admin/forecast-plan/${plan.body.planId}/approve`;
  expect((await request(app).post(url).set(bearer(maker)).send({ reason: "Human review completed" })).status).toBe(403);
  const approve = await request(app).post(url).set(bearer(admin)).send({ reason: "Human review completed" });
  expect(approve.body).toMatchObject({ stockChanged: false, dispatched: false });
  expect((await request(app).post(url).set(bearer(admin)).send({ reason: "Human review completed" })).body.approval._id).toBe(approve.body.approval._id);
  expect(await Approval.countDocuments({ planId: plan.body.planId })).toBe(1);
  await Batch.create({ batchId: "CHANGED", vaccineType: "Synthetic Vaccine A", manufacturer: "Synthetic Demo Manufacturer", quantity: 50 });
  expect((await request(app).post(url).set(bearer(admin)).send({ reason: "Human review completed" })).status).toBe(409);
  expect((await Batch.findOne({ batchId: "CHANGED" })).quantity).toBe(50);
});
test("compatibility migration backfills exact synthetic seed ownership only and is idempotent", async () => {
  await Order.updateMany({}, { $unset: { manufacturer: 1 } }, { timestamps: false });
  await Order.create({ orderId: "NOT-SEED", auditBatchId: "REF", vaccineType: "Synthetic Vaccine A", hospital: "Synthetic Demo Hospital", region: "Synthetic Demo Region", isDemo: true });
  const backfill = require("../scripts/backfillSyntheticDemandOwners");
  expect(await backfill()).toBe(108); expect(await backfill()).toBe(0);
  expect((await Order.findOne({ orderId: "NOT-SEED" })).manufacturer).toBeUndefined();
});
test("forecast plan excludes held stock, non-synthetic inventory and insufficient shelf life", async () => {
  const run = await ForecastRun.create({ createdBy: admin._id, vaccineType: "Synthetic Vaccine A", region: "R", result: await ai.getRegionalForecast() });
  const base = { vaccineType: "Synthetic Vaccine A", manufacturer: "Synthetic Demo Manufacturer", quantity: 200,
    releaseVisibleToExternal: true, productionApproved: true, labApproved: true, reportStatus: "Reported", isDemo: true,
    expiresAt: new Date(Date.now() + 365 * 86400000) };
  await Batch.create([{ ...base, batchId: "ELIGIBLE" }, { ...base, batchId: "HELD", coldChainHoldAlertIds: ["ALERT-TEST"] },
    { ...base, batchId: "NEAR-EXPIRY", expiresAt: new Date(Date.now() + 86400000) }, { ...base, batchId: "NON-DEMO", isDemo: false }]);
  const result = await request(app).post("/api/admin/forecast-plan").set(bearer(admin)).send({ runIds: [String(run._id)], destinationCapacity: 500, transportCapacity: 500, minimumShelfLifeDays: 30 });
  expect(result.status).toBe(201);
  expect(ai.getForecastAllocation.mock.calls.at(-1)[0].inventory.map(row => row.batchId)).toEqual(["ELIGIBLE"]);
  expect(result.body.exclusions).toHaveLength(3);
});
