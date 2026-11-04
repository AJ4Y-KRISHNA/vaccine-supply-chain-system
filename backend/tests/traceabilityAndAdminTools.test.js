jest.mock("../services/blockchainService", () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : jest.fn().mockResolvedValue(null) }));
const express = require("express");
const request = require("supertest");
const User = require("../models/user");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Order = require("../models/Order");
const TemperatureLog = require("../models/TemperatureLog");
const Alert = require("../models/TemperatureAlert");
const Notification = require("../models/Notification");
const Vaccination = require("../models/Vaccination");
const { issueToken } = require("../middleware/auth");
const { connect, close, fixture, examplePolicy } = require("./helpers/coldChainFixture");

const app = express();
app.use(express.json());
app.use("/api/admin", require("../routes/adminRoutes"));
app.use("/api/traceability", require("../routes/traceabilityRoutes"));
const bearer = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });
let f, admin, maker, otherMaker, distributor, hospital, otherHospital;
beforeAll(connect, 15000);
afterAll(close);
beforeEach(async () => {
  f = await fixture();
  [admin, maker, otherMaker, distributor, hospital, otherHospital] = await User.create([
    { email: `${f.batchId}-admin@test`, role: "admin", canReviewColdChain: true },
    { email: `${f.batchId}-maker@test`, role: "manufacturer", manufacturer: "maker-a" },
    { email: `${f.batchId}-othermaker@test`, role: "manufacturer", manufacturer: "maker-b" },
    { email: `${f.batchId}-dist@test`, role: "distributor", distributor: "dist-a" },
    { email: `${f.batchId}-hospital@test`, role: "healthcare", hospital: "hospital-a" },
    { email: `${f.batchId}-otherhospital@test`, role: "healthcare", hospital: "hospital-b" },
  ]);
});

test("journey combines batch/order/shipment/telemetry/alert/delivery/administration into timestamped role events", async () => {
  await Order.create({ orderId: `ORDER-${f.batchId}`, auditBatchId: `AUDIT-${f.batchId}`, hospital: "hospital-a", centerId: "hospital-a",
    allocatedBatchId: f.batchId, shipmentId: f.shipmentId, requestedDoses: 10, status: "Approved", reviewedAt: f.at(1), reviewedBy: String(admin._id) });
  await Shipment.updateOne({ shipmentId: f.shipmentId }, { $set: { orderId: `ORDER-${f.batchId}`, statusHistory: [
    { status: "In Transit", timestamp: f.at(2) }, { status: "Delivery Confirmed by Hospital", timestamp: f.at(4) },
  ] } });
  await TemperatureLog.create({ batchId: f.batchId, shipmentId: f.shipmentId, deviceId: "DEVICE-1", temperature: 5, humidity: 55, batteryLevel: 97, recordedAt: f.at(3), status: "Normal", location: { lat: 9.9, lng: 76.2 }, simulation: { source: "software-iot-simulator" } });
  await Alert.create({ alertId: `ALERT-${f.batchId}`, batchId: f.batchId, shipmentId: f.shipmentId, deviceId: "DEVICE-1", currentTemperature: 9,
    minimumAllowedTemperature: 2, maximumAllowedTemperature: 8, violationType: "HIGH_TEMPERATURE", severity: "WARNING", reason: "Synthetic high test reading",
    timestamp: f.at(3), excursionStartedAt: f.at(3), latestReadingAt: f.at(3), phase: "REVIEW_REQUIRED", manufacturerKey: "maker-a" });
  await Notification.create({ recipientRole: "healthcare", recipientRefKey: "hospital-a", alertId: `ALERT-${f.batchId}`, title: "Alert", message: "Synthetic test", type: "warning" });
  await Vaccination.create({ batchId: f.batchId, shipmentId: f.shipmentId, hospital: "hospital-a", eventType: "Delivery Confirmation", receivedDoses: 10, date: f.at(4) });
  await Vaccination.create({ batchId: f.batchId, shipmentId: f.shipmentId, hospital: "hospital-a", eventType: "Vaccination", dosesUsed: 2, date: f.at(5) });

  const response = await request(app).get(`/api/traceability/batches/${f.batchId}`).set(bearer(admin));
  expect(response.status).toBe(200);
  expect(response.body.readings).toHaveLength(1);
  expect(response.body.events.map(event => event.kind)).toEqual(expect.arrayContaining(["batch", "order", "shipment", "telemetry", "alert", "delivery", "administration"]));
  expect(response.body.events.find(event => event.title === "Order Approved").role).toBe("Admin");
  expect(response.body.events.find(event => event.kind === "telemetry").deviceId).toBe("DEVICE-1");
  expect(response.body.events.some(event => Object.hasOwn(event, "patientName"))).toBe(false);
});

test("journey access stays scoped to each organization's assigned batch/shipment", async () => {
  expect((await request(app).get(`/api/traceability/batches/${f.batchId}`).set(bearer(maker))).status).toBe(200);
  expect((await request(app).get(`/api/traceability/batches/${f.batchId}`).set(bearer(distributor))).status).toBe(200);
  expect((await request(app).get(`/api/traceability/batches/${f.batchId}`).set(bearer(hospital))).status).toBe(200);
  expect((await request(app).get(`/api/traceability/batches/${f.batchId}`).set(bearer(otherMaker))).status).toBe(404);
  expect((await request(app).get(`/api/traceability/batches/${f.batchId}`).set(bearer(otherHospital))).status).toBe(404);
  expect((await request(app).get("/api/traceability/batches")).status).toBe(401);
});

test("admin can grant/revoke reviewer capability with immutable reasoned audit; other roles cannot", async () => {
  const target = await User.create({ email: `new-${f.batchId}@test`, role: "manufacturer", manufacturer: "maker-a", canReviewColdChain: false });
  const path = `/api/admin/cold-chain/reviewers/${target._id}`;
  const denied = await request(app).patch(path).set(bearer(maker)).send({ canReviewColdChain: true, reason: "Needed for demo review" });
  expect(denied.status).toBe(403);
  expect((await request(app).patch(path).set(bearer(admin)).send({ canReviewColdChain: true, reason: "Assigned as quality reviewer" })).status).toBe(200);
  expect((await User.findById(target._id)).canReviewColdChain).toBe(true);
  expect((await request(app).patch(path).set(bearer(admin)).send({ canReviewColdChain: false, reason: "Role rotation completed" })).status).toBe(200);
  const response = await request(app).get("/api/admin/cold-chain/reviewers").set(bearer(admin));
  expect(response.body.reviewers.find(user => user.userId === String(target._id)).canReviewColdChain).toBe(false);
  expect(response.body.audit.map(entry => entry.action)).toEqual(expect.arrayContaining(["GRANT_REQUESTED", "GRANT_APPLIED", "REVOKE_REQUESTED", "REVOKE_APPLIED"]));
  expect(response.body.audit.every(entry => entry.reason.length >= 3)).toBe(true);
  await expect(require("../models/ReviewerPermissionAudit").updateOne({}, { $set: { reason: "tampered" } })).rejects.toThrow("Append-only");
});

test("cannot revoke the only active designated reviewer and readiness never returns configuration secrets", async () => {
  await User.updateMany({ role: { $in: ["admin", "manufacturer"] } }, { $set: { canReviewColdChain: false } });
  await User.updateOne({ _id: admin._id }, { $set: { canReviewColdChain: true } });
  const blocked = await request(app).patch(`/api/admin/cold-chain/reviewers/${admin._id}`).set(bearer(admin)).send({ canReviewColdChain: false, reason: "Remove current reviewer" });
  expect(blocked.status).toBe(409);
  const secondReviewer = await User.create({ email: `second-${f.batchId}@test`, role: "manufacturer", manufacturer: "maker-a", canReviewColdChain: true });
  const concurrentRevocations = await Promise.all([admin, secondReviewer].map(user => request(app).patch(`/api/admin/cold-chain/reviewers/${user._id}`).set(bearer(admin)).send({ canReviewColdChain: false, reason: "Rotate quality review responsibility" })));
  expect(concurrentRevocations.map(response => response.status).sort()).toEqual([200, 409]);
  expect(await User.countDocuments({ role: { $in: ["admin", "manufacturer"] }, canReviewColdChain: true, disabled: { $ne: true } })).toBe(1);
  const readiness = await request(app).get("/api/admin/readiness").set(bearer(admin));
  expect(readiness.status).toBe(200);
  expect(JSON.stringify(readiness.body)).not.toMatch(/PRIVATE_KEY|JWT_SECRET|REFRESH_SECRET|TEMP_API_KEY|0x[0-9a-f]{64}/i);
  expect(readiness.body).not.toHaveProperty("privateKey");
});
