const express = require("express");
const request = require("supertest");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Vaccination = require("../models/Vaccination");
const User = require("../models/user");
const batchRoutes = require("../routes/batchRoutes");
const vaccinationRoutes = require("../routes/vaccinationRoutes");
const { issueToken } = require("../middleware/auth");
const { connect, close, fixture } = require("./helpers/coldChainFixture");

const app = express();
app.use(express.json());
app.use("/api/batches", batchRoutes);
app.use("/api/vaccinations", vaccinationRoutes);

let f;
let actors;
let auth;

beforeAll(connect, 15000);
afterAll(close);

beforeEach(async () => {
  f = await fixture({ approved: false });
  const tag = f.batchId.toLowerCase();
  const [manufacturer, otherManufacturer, distributor, healthcare] = await Promise.all([
    User.create({ email: `maker-${tag}@example.test`, password: "test", role: "manufacturer", manufacturer: "maker-a" }),
    User.create({ email: `other-maker-${tag}@example.test`, password: "test", role: "manufacturer", manufacturer: "maker-b" }),
    User.create({ email: `dist-${tag}@example.test`, password: "test", role: "distributor", distributor: "dist-a" }),
    User.create({ email: `hospital-${tag}@example.test`, password: "test", role: "healthcare", hospital: "hospital-a" }),
  ]);
  actors = { admin: f.reviewer, manufacturer, otherManufacturer, distributor, healthcare };
  auth = Object.fromEntries(Object.entries(actors).map(([role, user]) => [role, { Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` }]));
});

test("new batches default to active; legacy terminal records require reason, time and actor", async () => {
  const active = new Batch({ batchId: "DEFAULT-ACTIVE" });
  expect(active.disposition.status).toBe("active");
  const invalid = new Batch({ batchId: "INVALID-TERMINAL", disposition: { status: "discarded" } });
  await expect(invalid.validate()).rejects.toMatchObject({ name: "ValidationError" });
  expect(invalid.errors["disposition.reasonCode"]).toBeDefined();
  expect(invalid.errors["disposition.recordedAt"]).toBeDefined();
  expect(invalid.errors["disposition.recordedBy"]).toBeDefined();
});

test("owning manufacturer can recall once; retries are idempotent and terminal states cannot be changed", async () => {
  const url = `/api/batches/${f.batchId}/disposition`;
  const saved = await request(app).patch(url).set(auth.manufacturer).send({ status: "recalled", reasonCode: "MANUFACTURER_RECALL" });
  expect(saved.status).toBe(200);
  expect(saved.body.disposition).toMatchObject({ status: "recalled", reasonCode: "MANUFACTURER_RECALL", recordedByRole: "manufacturer" });
  expect(saved.body.disposition.recordedAt).toBeTruthy();
  expect(saved.body.disposition.recordedBy).toBe(String(actors.manufacturer._id));

  const retry = await request(app).patch(url).set(auth.manufacturer).send({ status: "recalled", reasonCode: "DIFFERENT_RETRY_CODE" });
  expect(retry.status).toBe(200);
  expect(retry.body.alreadySet).toBe(true);
  expect(retry.body.disposition.reasonCode).toBe("MANUFACTURER_RECALL");
  expect((await request(app).patch(url).set(auth.manufacturer).send({ status: "discarded", reasonCode: "DAMAGE" })).status).toBe(409);
  expect((await request(app).patch(url).set(auth.manufacturer).send({ status: "active", reasonCode: "RESET" })).status).toBe(400);
});

test("organization ownership and role restrictions are enforced", async () => {
  const url = `/api/batches/${f.batchId}/disposition`;
  expect((await request(app).patch(url).set(auth.otherManufacturer).send({ status: "recalled", reasonCode: "MANUFACTURER_RECALL" })).status).toBe(404);
  expect((await request(app).patch(url).set(auth.healthcare).send({ status: "recalled", reasonCode: "QUALITY_RECALL" })).status).toBe(403);
  expect((await request(app).patch(url).set(auth.manufacturer).send({ status: "recalled" })).status).toBe(400);
  expect((await request(app).patch(url).set(auth.manufacturer).send({ status: "recalled", reasonCode: "not-a-code" })).status).toBe(400);
  expect((await request(app).patch(url).set(auth.manufacturer).send({ status: "recalled", reasonCode: "VALID", recordedAt: new Date().toISOString() })).status).toBe(400);
});

test("expired requires the stored expiry date to have passed and an in-scope actor", async () => {
  const url = `/api/batches/${f.batchId}/disposition`;
  await Shipment.updateOne({ shipmentId: f.shipmentId }, { $set: { hospitalConfirmed: true } });
  f.batch.expiresAt = new Date(Date.now() + 86400000);
  await f.batch.save();
  expect((await request(app).patch(url).set(auth.healthcare).send({ status: "expired", reasonCode: "EXPIRY_DATE_REACHED" })).status).toBe(409);

  f.batch.expiresAt = new Date(Date.now() - 86400000);
  await f.batch.save();
  const response = await request(app).patch(url).set(auth.healthcare).send({ status: "expired", reasonCode: "EXPIRY_DATE_REACHED" });
  expect(response.status).toBe(200);
  expect(response.body.disposition).toMatchObject({ status: "expired", recordedByRole: "healthcare" });
});

test("healthcare can mark administered only after the whole lot is delivered and recorded as used", async () => {
  const url = `/api/batches/${f.batchId}/disposition`;
  f.batch.quantity = 4;
  await f.batch.save();
  await Shipment.updateOne({ shipmentId: f.shipmentId }, { $set: { quantity: 4, hospitalConfirmed: true } });
  await Vaccination.create({ batchId: f.batchId, shipmentId: f.shipmentId, hospital: "hospital-a", eventType: "Delivery Confirmation", receivedDoses: 4 });
  await Vaccination.create({ batchId: f.batchId, hospital: "hospital-a", eventType: "Vaccination", administrationStatus: "Administered", dosesUsed: 3 });

  const incomplete = await request(app).patch(url).set(auth.healthcare).send({ status: "administered", reasonCode: "FULLY_ADMINISTERED" });
  expect(incomplete.status).toBe(409);
  expect(incomplete.body.code).toBe("BATCH_STOCK_REMAINS");

  await Vaccination.create({ batchId: f.batchId, hospital: "hospital-a", eventType: "Vaccination", administrationStatus: "Administered", dosesUsed: 1 });
  const completed = await request(app).patch(url).set(auth.healthcare).send({ status: "administered", reasonCode: "FULLY_ADMINISTERED" });
  expect(completed.status).toBe(200);
  expect(completed.body.disposition.status).toBe("administered");
});

test("admin may record discard, and terminal batches are excluded from future stock allocation", async () => {
  const response = await request(app).patch(`/api/batches/${f.batchId}/disposition`).set(auth.admin).send({ status: "discarded", reasonCode: "DAMAGED_PACKAGING" });
  expect(response.status).toBe(200);
  const result = require("../services/inventoryEligibility").assessBatch(
    await Batch.findOne({ batchId: f.batchId }).lean(), [], [], [{ email: `maker-${f.batchId.toLowerCase()}@example.test`, manufacturer: "maker-a" }]
  );
  expect(result.eligible).toBe(false);
  expect(result.reasons).toContain("BATCH_DISPOSITION_DISCARDED");
});

test("terminal disposition blocks later protected administration operations", async () => {
  await request(app).patch(`/api/batches/${f.batchId}/disposition`).set(auth.admin).send({ status: "recalled", reasonCode: "QUALITY_RECALL" });
  const response = await request(app).post("/api/vaccinations/administer").set(auth.admin).send({ batchId: f.batchId, dosesUsed: 1 });
  expect(response.status).toBe(409);
  expect(response.body.code).toBe("BATCH_DISPOSITIONED");
});

test("older protected operations cannot overwrite disposition fields from a request body", async () => {
  const response = await request(app).post("/api/vaccinations/administer").set(auth.admin).send({
    batchId: f.batchId, dosesUsed: 1, disposition: { status: "active" },
  });
  expect(response.status).toBe(400);
  expect(response.body.error).toMatch(/Protected fields/);
  expect((await Batch.findOne({ batchId: f.batchId }).lean()).disposition.status).toBe("active");
});
