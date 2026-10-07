const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const LocationHistory = require("../models/LocationHistory");
const User = require("../models/user");
const { issueToken } = require("../middleware/auth");
const { connect, close, fixture } = require("./helpers/coldChainFixture");

const app = express();
app.use("/api/location-history", require("../routes/locationHistoryRoutes"));
const bearer = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });

beforeAll(connect, 15000);
afterAll(close);

let f, users;
beforeEach(async () => {
  f = await fixture();
  const ownerKey = String(f.batchId).toLowerCase();
  await require("../models/Batch").updateOne({ batchId: f.batchId }, { manufacturer: `maker-${ownerKey}` });
  await require("../models/Shipment").updateOne({ shipmentId: f.shipmentId }, {
    distributor: `dist-${ownerKey}`, destination: `hospital-${ownerKey}`,
  });
  users = await User.create([
    { email: `${f.batchId}-admin@test`, password: "test", role: "admin" },
    { email: `${f.batchId}-maker@test`, password: "test", role: "manufacturer", manufacturer: `maker-${ownerKey}` },
    { email: `${f.batchId}-dist@test`, password: "test", role: "distributor", distributor: `dist-${ownerKey}` },
    { email: `${f.batchId}-hospital@test`, password: "test", role: "healthcare", hospital: `hospital-${ownerKey}` },
    { email: `${f.batchId}-other@test`, password: "test", role: "distributor", distributor: "other-org" },
  ]);
  await LocationHistory.create([0, 1].map(minute => ({
    batchId: f.batchId, shipmentId: f.shipmentId, deviceId: "SENSOR-1", vehicleId: "TRUCK-1",
    sequenceNumber: minute, temperatureLogId: new mongoose.Types.ObjectId(), recordedAt: new Date(f.at(minute)),
    location: { lat: 9 + minute / 10, lng: 76 + minute / 10 }, source: "auto-simulated",
  })));
});

test("returns a batch GPS trail in chronological order to its authorized roles", async () => {
  expect(await LocationHistory.countDocuments({ batchId: f.batchId })).toBe(2);
  for (const user of users.slice(0, 4)) {
    const response = await request(app).get(`/api/location-history/${f.batchId}`).set(bearer(user));
    expect(response.status).toBe(200);
    expect(response.body.points.map(point => point.sequenceNumber)).toEqual([0, 1]);
    expect(response.body.points[1].location).toEqual({ lat: 9.1, lng: 76.1 });
  }
});

test("hides another organization's history and validates query limits", async () => {
  expect((await request(app).get(`/api/location-history/${f.batchId}`).set(bearer(users[4]))).status).toBe(404);
  expect((await request(app).get(`/api/location-history/${f.batchId}?limit=1001`).set(bearer(users[0]))).status).toBe(400);
});

test("requires an authenticated role", async () => {
  expect((await request(app).get(`/api/location-history/${f.batchId}`)).status).toBe(401);
});
