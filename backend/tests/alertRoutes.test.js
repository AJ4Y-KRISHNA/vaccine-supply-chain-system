jest.mock("../services/blockchainService", () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : jest.fn().mockResolvedValue(null) }));
const express = require("express");
const request = require("supertest");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Alert = require("../models/TemperatureAlert");
const Audit = require("../models/ColdChainAudit");
const User = require("../models/user");
const Vaccination = require("../models/Vaccination");
const { issueToken } = require("../middleware/auth");
const { evaluateReading } = require("../services/temperatureAlertService");
const { connect, close, fixture, examplePolicy } = require("./helpers/coldChainFixture");
process.env.TEMP_API_KEY = "test-temperature-key";
const app = express();
app.use(express.json());
for (const [prefix, routes] of [["alerts", "alertRoutes"], ["temperature", "temperatureRoutes"], ["distribution", "distributionRoutes"], ["vaccinations", "vaccinationRoutes"], ["shipments", "shipmentRoutes"], ["manufacturer", "manufacturerRoutes"], ["batches", "batchRoutes"]]) app.use(`/api/${prefix}`, require(`../routes/${routes}`));
beforeAll(connect, 15000);
afterAll(close);
const bearer = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });
let f, admin, maker, otherMaker, distributor, hospital, otherHospital;
beforeEach(async () => {
  f = await fixture();
  [admin, maker, otherMaker, distributor, hospital, otherHospital] = await User.create([
    { email: `${f.batchId}-admin@test`, password: "test", role: "admin" },
    { email: `${f.batchId}-maker@test`, password: "test", role: "manufacturer", manufacturer: "maker-a" },
    { email: `${f.batchId}-other@test`, password: "test", role: "manufacturer", manufacturer: "maker-b" },
    { email: `${f.batchId}-dist@test`, password: "test", role: "distributor", distributor: "dist-a" },
    { email: `${f.batchId}-hospital@test`, password: "test", role: "healthcare", hospital: "hospital-a" },
    { email: `${f.batchId}-otherhospital@test`, password: "test", role: "healthcare", hospital: "hospital-b" },
  ]);
});
const list = user => request(app).get(`/api/alerts?batchId=${f.batchId}`).set(bearer(user));
async function held() {
  for (let minute = 0; minute <= 2; minute++) await evaluateReading(f.reading(10, minute));
  return Alert.findOne({ batchId: f.batchId, requiresQualityReview: true });
}
const action = (user, alert, kind, minute = 3) => request(app).patch(`/api/alerts/${alert.alertId}/${kind}`).set(bearer(user)).send({ reason: "Reviewed complete synthetic evidence", asOf: f.at(minute) });

test("approval requires a real designated reviewer, source, complete rules, and batch ownership", async () => {
  const url = `/api/alerts/policies/batch/${f.batchId}/approve`;
  expect((await request(app).post(url).set(bearer(admin)).send(examplePolicy)).status).toBe(403);
  expect((await request(app).post(url).set(bearer(f.reviewer)).send({ minimumTemperature: 2, maximumTemperature: 8 })).status).toBe(400);
  const approved = await request(app).post(url).set(bearer(f.reviewer)).send(examplePolicy);
  expect(approved.status).toBe(201);
  expect(approved.body.policy.approvedBy).toBe(String(f.reviewer._id));
  expect(await Audit.countDocuments({ batchId: f.batchId, action: "POLICY_APPROVED" })).toBe(1);
});
test("brief alerts are restricted to admin and owning manufacturer; manufacturer can acknowledge", async () => {
  await evaluateReading(f.reading(10));
  expect((await list(admin)).body.total).toBe(1);
  const result = await list(maker);
  expect(result.body.total).toBe(1);
  expect((await list(otherMaker)).body.total).toBe(0);
  expect((await list(distributor)).body.total).toBe(0);
  expect((await action(maker, result.body.alerts[0], "acknowledge")).status).toBe(200);
});
test("quarantine is visible only to the assigned distributor/hospital and cannot leak through ID filters", async () => {
  const alert = await held();
  expect((await list(distributor)).body.total).toBe(1);
  expect((await list(hospital)).body.total).toBe(1);
  expect((await list(otherHospital)).body.total).toBe(0);
  expect((await request(app).get(`/api/alerts/${alert.alertId}`).set(bearer(otherHospital))).status).toBe(404);
  expect((await request(app).get(`/api/alerts?batchId=${f.batchId}&alertId=${alert.alertId}`).set(bearer(otherHospital))).body.total).toBe(0);
});
test("normal recovery preserves holds; current evidence review and explicit clearance restore the overlay only", async () => {
  const alert = await held();
  expect((await action(f.reviewer, alert, "clear", 2)).status).toBe(409);
  await evaluateReading(f.reading(5, 3));
  expect((await action(admin, alert, "clear")).status).toBe(403);
  expect((await action(f.reviewer, alert, "clear")).status).toBe(409);
  expect((await action(f.reviewer, alert, "review")).status).toBe(200);
  const cleared = await action(f.reviewer, alert, "clear");
  expect(cleared.status).toBe(200);
  expect(cleared.body.alert).toMatchObject({ phase: "CLEARED", requiresQualityReview: false });
  const batch = await Batch.findOne({ batchId: f.batchId });
  expect(batch.coldChainHoldAlertIds).toHaveLength(0);
  expect(batch.status).toBe("Ready");
  expect((await Shipment.findOne({ shipmentId: f.shipmentId })).status).toBe("In Transit");
  const detail = await request(app).get(`/api/alerts/${alert.alertId}`).set(bearer(f.reviewer));
  expect(detail.body.auditTrail.map(a => a.action)).toEqual(expect.arrayContaining(["QUARANTINE_AUTHORIZED", "QUALITY_REVIEW", "CLEAR_AUTHORIZED", "CLEARED"]));
});
test("new telemetry invalidates a previous review and stale evidence cannot clear", async () => {
  const alert = await held();
  await evaluateReading(f.reading(5, 3));
  expect((await action(f.reviewer, alert, "review", 3)).status).toBe(200);
  await evaluateReading(f.reading(5, 4));
  expect((await action(f.reviewer, alert, "clear", 4)).status).toBe(409);
  expect((await action(f.reviewer, alert, "review", 10)).status).toBe(409);
});
test("clearing one event never removes another event's quarantine", async () => {
  const first = await held();
  await evaluateReading(f.reading(5, 3));
  await evaluateReading(f.reading(10, 4));
  await evaluateReading(f.reading(10, 5));
  await evaluateReading(f.reading(10, 6));
  await evaluateReading(f.reading(5, 7));
  expect((await action(f.reviewer, first, "review", 7)).status).toBe(200);
  expect((await action(f.reviewer, first, "clear", 7)).status).toBe(200);
  expect((await Batch.findOne({ batchId: f.batchId })).coldChainHoldAlertIds).toHaveLength(1);
});
test("a newly applied manual quarantine invalidates any earlier quality review", async () => {
  await evaluateReading(f.reading(10, 0));
  await evaluateReading(f.reading(5, 1));
  const alert = await Alert.findOne({ batchId: f.batchId });
  expect((await action(f.reviewer, alert, "review", 1)).status).toBe(200);
  expect((await action(maker, alert, "quarantine", 1)).status).toBe(200);
  expect((await action(f.reviewer, alert, "clear", 1)).status).toBe(409);
});
test("hold blocks every dispatch/administration alias before operational writes", async () => {
  await held();
  const endpoints = [
    ["post", "/distribution/admin/distribute", admin], ["post", "/distribution/distributor/receive-batch", distributor],
    ["patch", `/distribution/distributor/verify/${f.shipmentId}`, distributor], ["patch", `/distribution/distributor/status/${f.shipmentId}`, distributor],
    ["patch", `/distribution/distributor/supply/${f.shipmentId}`, distributor], ["patch", `/distribution/healthcare/confirm/${f.shipmentId}`, hospital],
    ["post", "/shipments/create", admin], ["post", "/vaccinations/administer", hospital], ["post", "/vaccinations/workflow", hospital],
    ["post", "/vaccinations/create", hospital], ["post", "/vaccinations/inventory", hospital], ["post", "/vaccinations/report", hospital],
    ["post", "/manufacturer/batch", maker], ["post", "/manufacturer/workflow", maker], ["post", "/manufacturer/batch/report", maker],
    ["post", `/manufacturer/batch/${f.batchId}/sign-release`, maker],
  ];
  for (const [method, endpoint, user] of endpoints) {
    const response = await request(app)[method](`/api${endpoint}`).set(bearer(user)).send({ batchId: f.batchId, dosesUsed: 1, status: "Delivered" });
    expect({ endpoint, status: response.status, code: response.body.code }).toEqual({ endpoint, status: 409, code: "COLD_CHAIN_HOLD" });
  }
  expect(await Vaccination.countDocuments({ batchId: f.batchId })).toBe(0);
  expect((await Batch.findOne({ batchId: f.batchId })).quantity).toBe(100);
});
test("operational actions require current server-side role, traceable batch, and protected fields", async () => {
  expect((await request(app).post("/api/vaccinations/administer").set(bearer(maker)).send({ batchId: f.batchId })).status).toBe(403);
  expect((await request(app).post("/api/vaccinations/administer").set(bearer(hospital)).send({ dosesUsed: 1 })).status).toBe(400);
  expect((await request(app).post("/api/shipments/create").set(bearer(admin)).send({ batchId: f.batchId, coldChainHoldAlertIds: [] })).status).toBe(400);
  expect((await request(app).post("/api/batches/create").set(bearer(admin)).send({ batchId: f.batchId })).status).toBe(409);
  const staleToken = bearer(f.reviewer);
  await User.updateOne({ _id: f.reviewer._id }, { $set: { canReviewColdChain: false } });
  expect((await request(app).post(`/api/alerts/policies/batch/${f.batchId}/approve`).set(staleToken).send(examplePolicy)).status).toBe(403);
});
test("AUTH_OPTIONAL never bypasses cold-chain safety authorization", async () => {
  process.env.AUTH_OPTIONAL = "true";
  try {
    expect((await request(app).get("/api/alerts")).status).toBe(401);
    expect((await request(app).post("/api/vaccinations/administer").send({ batchId: f.batchId })).status).toBe(401);
  } finally { delete process.env.AUTH_OPTIONAL; }
});
test("conflicting route/body identifiers cannot guard a different batch from the one mutated", async () => {
  await held();
  const unrelated = await fixture();
  const result = await request(app).post(`/api/manufacturer/batch/${f.batchId}/sign-release`).set(bearer(admin))
    .send({ shipmentId: unrelated.shipmentId, role: "production" });
  expect(result.status).toBe(400);
  expect((await Batch.findOne({ batchId: f.batchId })).productionApproved).toBe(false);
});
test("unheld operations still reach the existing implementation", async () => {
  const result = await request(app).post("/api/shipments/create").set(bearer(admin)).send({ shipmentId: `${f.shipmentId}-new`, batchId: f.batchId, status: "Created" });
  expect(result.status).toBe(200);
  expect(result.body.batchId).toBe(f.batchId);
  expect(await Shipment.countDocuments({ batchId: f.batchId })).toBe(2);
});
test("legacy ingest contract accepts a single reading or array and invokes the same engine", async () => {
  const payload = { temperature: 10, batchId: f.batchId, shipmentId: f.shipmentId, sensorId: "legacy-device", recordedAt: f.at(0), humidity: 60, batteryLevel: 90 };
  const single = await request(app).post("/api/temperature/ingest").set("x-api-key", "test-temperature-key").send(payload);
  expect(single.status).toBe(200);
  expect(single.body[0].evaluation).toMatchObject({ evaluated: true, severity: "WARNING" });
  const array = await request(app).post("/api/temperature/ingest").set("x-api-key", "test-temperature-key").send([{ temperature: 5 }]);
  expect(array.status).toBe(200);
  expect(array.body[0].evaluation.evaluated).toBe(false);
});
