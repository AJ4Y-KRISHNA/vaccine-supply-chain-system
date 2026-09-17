jest.mock("../services/blockchainService", () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : jest.fn().mockResolvedValue(null) }));
jest.mock("../services/aiService", () => ({ getForecast: jest.fn().mockResolvedValue({ predicted_demand: 0 }), getSentiment: jest.fn().mockResolvedValue({ score: 0.5 }) }));
const express = require("express");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Order = require("../models/Order");
const Vaccination = require("../models/Vaccination");
const { authenticate, issueToken, issueRefreshToken } = require("../middleware/auth");
const { secret, validateSecurity } = require("../config/security");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const app = express(); app.use(express.json());
const prefixes = { auth: "auth", dashboard: "dashboard", admin: "admin", orders: "order", shipments: "shipment",
  vaccinations: "vaccination", distribution: "distribution", manufacturer: "manufacturer", batches: "batch", forecast: "forecast", sentiment: "sentiment", decision: "decision", feedback: "feedback" };
for (const [prefix, file] of Object.entries(prefixes)) app.use(`/api/${prefix}`, require(`../routes/${file}Routes`));
app.get("/identity", authenticate, (req, res) => res.json(req.user));
const bearer = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: "admin", tokenVersion: user.tokenVersion })}` });
let f, hospital, outsider, maker, distributor;
beforeAll(connect, 15000); afterAll(close);
beforeEach(async () => {
  f = await fixture();
  [hospital, outsider, maker, distributor] = await User.create([
    { email: `${f.batchId}-h@test`, password: await bcrypt.hash("demo-password", 4), role: "healthcare", hospital: "hospital-a" },
    { email: `${f.batchId}-x@test`, password: "plaintext-legacy", role: "healthcare", hospital: "hospital-b" },
    { email: `${f.batchId}-m@test`, password: "test", role: "manufacturer", manufacturer: "maker-a" },
    { email: `${f.batchId}-d@test`, password: "test", role: "distributor", distributor: "dist-a" },
  ]);
});

test.each(["dashboard/admin", "dashboard/distributor", "admin/users", "shipments/all", "orders/distributor", "distribution", "vaccinations/all", "manufacturer/batches", "feedback/admin", "batches/verify/missing"])("anonymous reads are denied: %s", async path => {
  expect((await request(app).get(`/api/${path}`)).status).toBe(401);
});
test.each(["forecast", "sentiment", "decision/distribution-decision"])("anonymous computation is denied: %s", async path => {
  expect((await request(app).post(`/api/${path}`).send({})).status).toBe(401);
});
test("login accepts hashes, rejects plaintext and operator injection, and hides password fields", async () => {
  const login = await request(app).post("/api/auth/login").send({ email: hospital.email, password: "demo-password", role: "healthcare" });
  expect(login.status).toBe(200);
  expect(login.body.token).toBeTruthy();
  expect(login.body.password).toBeUndefined();
  expect((await request(app).post("/api/auth/login").send({ email: outsider.email, password: "plaintext-legacy", role: "healthcare" })).status).toBe(401);
  expect((await request(app).post("/api/auth/login").send({ email: { $ne: null }, password: "demo-password", role: "healthcare" })).status).toBe(400);
  expect((await request(app).get("/identity").set(bearer(hospital))).body.password).toBeUndefined();
  expect((await User.findById(hospital._id)).password).toBeUndefined();
});
test("current DB role, disabled accounts, revoked sessions and token purpose are enforced", async () => {
  const auth = bearer(hospital);
  expect((await request(app).get("/api/admin/users").set(auth)).status).toBe(403);
  expect((await request(app).get("/api/dashboard/manufacturer").set(auth)).status).toBe(403);
  await User.updateOne({ _id: hospital._id }, { $inc: { tokenVersion: 1 } });
  expect((await request(app).get("/identity").set(auth)).status).toBe(401);
  hospital.tokenVersion = 1;
  const refresh = issueRefreshToken({ id: hospital._id, role: hospital.role, tokenVersion: 1 });
  expect((await request(app).get("/identity").set({ Authorization: `Bearer ${refresh}` })).status).toBe(401);
  await User.updateOne({ _id: hospital._id }, { $set: { disabled: true } });
  expect((await request(app).post("/api/auth/refresh").send({ refreshToken: refresh })).status).toBe(401);
});
test("hospital dashboard, raw records and order lists cannot leak another organization's records", async () => {
  await Vaccination.create({ batchId: f.batchId, hospital: "hospital-a", centerId: "hospital-a", dosesUsed: 1 });
  await Order.create({ orderId: `SCOPE-${f.batchId}`, auditBatchId: f.batchId, hospital: "hospital-a", centerId: "hospital-a" });
  const shipment = await request(app).get("/api/shipments/all").set(bearer(outsider));
  expect(shipment.body).toEqual([]);
  expect((await request(app).get("/api/vaccinations/all").set(bearer(outsider))).body).toEqual([]);
  expect((await request(app).get("/api/orders/hospital?hospital=hospital-a").set(bearer(outsider))).body.orders).toEqual([]);
  const own = await request(app).get("/api/dashboard/healthcare").set(bearer(hospital));
  expect(own.status).toBe(200);
  expect(own.body.usageLogs.some(v => v.batchId === f.batchId)).toBe(true);
});
test("organization impersonation and editing someone else's shipment are denied", async () => {
  expect((await request(app).post("/api/orders/hospital").set(bearer(outsider)).send({ hospital: "hospital-a", requestedDoses: 5 })).status).toBe(403);
  expect((await request(app).patch(`/api/distribution/healthcare/confirm/${f.shipmentId}`).set(bearer(outsider)).send({})).status).toBe(403);
  await Shipment.updateOne({ shipmentId: f.shipmentId }, { $set: { distributor: "another-distributor" } });
  expect((await request(app).patch(`/api/distribution/distributor/status/${f.shipmentId}`).set(bearer(distributor)).send({ status: "Delivered" })).status).toBe(403);
});
test("explicit demo organization aliases work without exposing unrelated batches", async () => {
  await User.updateOne({ _id: outsider._id }, { $set: { organizationAliases: ["hospital-a"] } });
  const response = await request(app).get("/api/shipments/all").set(bearer(outsider));
  expect(response.body.some(s => s.shipmentId === f.shipmentId)).toBe(true);
  expect((await request(app).get(`/api/batches/verify/${f.batchId}`).set(bearer(maker))).status).not.toBe(401);
  await Batch.updateOne({ batchId: f.batchId }, { $set: { manufacturer: "other-maker" } });
  expect((await request(app).get(`/api/batches/verify/${f.batchId}`).set(bearer(maker))).status).toBe(404);
});
test("privilege and release flags cannot be mass-assigned through legacy business bodies", async () => {
  expect((await request(app).post("/api/manufacturer/batch").set(bearer(maker)).send({ batchId: f.batchId, releaseVisibleToExternal: true })).status).toBe(400);
  expect((await request(app).post("/api/manufacturer/batch").set(bearer(maker)).send({ batchId: `NEW-${f.batchId}`, manufacturer: "other-maker" })).status).toBe(403);
});
test("non-test startup rejects weak secrets and AUTH_OPTIONAL bypass", () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET, AUTH_OPTIONAL: process.env.AUTH_OPTIONAL };
  try {
    process.env.NODE_ENV = "production"; process.env.JWT_SECRET = "dev-secret";
    expect(() => secret("JWT_SECRET")).toThrow("32 random characters");
    process.env.NODE_ENV = "test"; process.env.AUTH_OPTIONAL = "true";
    expect(() => validateSecurity()).toThrow("bypass has been removed");
  } finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
