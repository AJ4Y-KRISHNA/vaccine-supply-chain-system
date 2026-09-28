const express = require("express");
const request = require("supertest");
const Shipment = require("../models/Shipment");
const TemperatureLog = require("../models/TemperatureLog");
const User = require("../models/user");
const { issueToken } = require("../middleware/auth");
const { connect, close, fixture } = require("./helpers/coldChainFixture");

const app = express();
app.use(express.json());
app.use("/api/live-shipments", require("../routes/liveShipmentRoutes"));

beforeAll(connect, 15000);
afterAll(close);

let f;
let admin;
let manufacturer;
let distributor;
let otherDistributor;
let hospital;
let otherHospital;
const bearer = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });

beforeEach(async () => {
  f = await fixture();
  const organization = String(f.batchId).toLowerCase();
  await require("../models/Batch").updateOne({ batchId: f.batchId }, { manufacturer: `maker-${organization}` });
  await Shipment.updateOne({ shipmentId: f.shipmentId }, { distributor: `dist-${organization}`, destination: `hospital-${organization}` });
  [admin, manufacturer, distributor, otherDistributor, hospital, otherHospital] = await User.create([
    { email: `${f.batchId}-admin@test`, password: "test", role: "admin" },
    { email: `${f.batchId}-maker@test`, password: "test", role: "manufacturer", manufacturer: `maker-${organization}` },
    { email: `${f.batchId}-dist@test`, password: "test", role: "distributor", distributor: `dist-${organization}` },
    { email: `${f.batchId}-otherdist@test`, password: "test", role: "distributor", distributor: `other-${organization}` },
    { email: `${f.batchId}-hospital@test`, password: "test", role: "healthcare", hospital: `hospital-${organization}` },
    { email: `${f.batchId}-otherhospital@test`, password: "test", role: "healthcare", hospital: `other-${organization}` },
  ]);
  await TemperatureLog.create([
    { batchId: f.batchId, shipmentId: f.shipmentId, deviceId: "sensor-old", temperature: 4.2, humidity: 57, batteryLevel: 92, location: { lat: 9.1, lng: 76.2 }, recordedAt: f.at(0), source: "auto-simulated" },
    { batchId: f.batchId, shipmentId: f.shipmentId, deviceId: "sensor-latest", vehicleId: "truck-a", temperature: 5.3, humidity: 58, batteryLevel: 91, location: { lat: 9.2, lng: 76.3 }, recordedAt: f.at(1), source: "manual-override" },
  ]);
});

test("returns latest linked telemetry and only the batch approved policy fields", async () => {
  const response = await request(app).get("/api/live-shipments").set(bearer(admin));
  expect(response.status).toBe(200);
  expect(response.body.shipments).toHaveLength(1);
  expect(response.body.shipments[0]).toMatchObject({
    shipmentId: f.shipmentId,
    batchId: f.batchId,
    policy: { minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 40, maximumHumidity: 80 },
    latestTelemetry: { deviceId: "sensor-latest", vehicleId: "truck-a", temperature: 5.3, humidity: 58, batteryLevel: 91, source: "manual-override", location: { lat: 9.2, lng: 76.3 } },
  });
  expect(response.body.shipments[0].policy).not.toHaveProperty("approvedBy");
});

test("applies organization visibility to manufacturer, distributor, and hospital accounts", async () => {
  const visible = async user => request(app).get("/api/live-shipments").set(bearer(user));
  expect((await visible(manufacturer)).body.total).toBe(1);
  expect((await visible(distributor)).body.total).toBe(1);
  expect((await visible(hospital)).body.total).toBe(1);
  expect((await visible(otherDistributor)).body.total).toBe(0);
  expect((await visible(otherHospital)).body.total).toBe(0);
});

test("returns 404 for an out-of-scope deep link and validates limit", async () => {
  const hidden = await Shipment.create({ shipmentId: `${f.shipmentId}-hidden`, batchId: f.batchId, distributor: "dist-b", destination: "hospital-b", status: "In Transit" });
  expect(hidden).toBeTruthy();
  const denied = await request(app).get(`/api/live-shipments?shipmentId=${hidden.shipmentId}`).set(bearer(distributor));
  expect(denied.status).toBe(404);
  expect((await request(app).get("/api/live-shipments?limit=101").set(bearer(admin))).status).toBe(400);
});

test("does not join batch-only telemetry to an individual shipment", async () => {
  await TemperatureLog.create({ batchId: f.batchId, temperature: 10, humidity: 30, recordedAt: f.at(2) });
  const response = await request(app).get(`/api/live-shipments?shipmentId=${f.shipmentId}`).set(bearer(admin));
  expect(response.status).toBe(200);
  expect(response.body.shipments[0].latestTelemetry.deviceId).toBe("sensor-latest");
  expect(response.body.shipments[0].latestTelemetry.temperature).toBe(5.3);
});

test("requires authentication", async () => {
  expect((await request(app).get("/api/live-shipments")).status).toBe(401);
});
