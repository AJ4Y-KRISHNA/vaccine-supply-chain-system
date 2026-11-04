const express = require("express");
const request = require("supertest");
const { issueToken } = require("../middleware/auth");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const TemperatureLog = require("../models/TemperatureLog");

const app = express();
app.use("/api/live-shipments", require("../routes/liveShipmentRoutes"));
let data;
let authorization;

beforeAll(connect, 15000);
afterAll(close);
beforeEach(async () => {
  data = await fixture();
  authorization = { Authorization: `Bearer ${issueToken({ id: data.reviewer._id, role: "admin" })}` };
  await TemperatureLog.create([0, 1, 2, 3, 4].map(index => ({
    shipmentId: data.shipmentId,
    batchId: data.batchId,
    deviceId: "SENSOR-HISTORY",
    vehicleId: "TRUCK-HISTORY",
    sequenceNumber: index,
    temperature: 4 + index / 10,
    humidity: 55 + index,
    batteryLevel: 99 - index,
    location: { lat: 9.9 + index / 1000, lng: 76.2 + index / 1000 },
    recordedAt: data.at(Math.floor(index / 2)),
  })));
});

test("returns every stored point in stable chronological pages, including timestamp ties", async () => {
  const first = await request(app).get(`/api/live-shipments/${data.shipmentId}/temperature-history?limit=2`).set(authorization);
  expect(first.status).toBe(200);
  expect(first.body.records.map(row => row.sequenceNumber)).toEqual([0, 1]);
  expect(first.body.hasMore).toBe(true);

  const second = await request(app).get(`/api/live-shipments/${data.shipmentId}/temperature-history?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`).set(authorization);
  expect(second.status).toBe(200);
  expect(second.body.records.map(row => row.sequenceNumber)).toEqual([2, 3]);
  expect(second.body.hasMore).toBe(true);

  const third = await request(app).get(`/api/live-shipments/${data.shipmentId}/temperature-history?limit=2&cursor=${encodeURIComponent(second.body.nextCursor)}`).set(authorization);
  expect(third.status).toBe(200);
  expect(third.body.records.map(row => row.sequenceNumber)).toEqual([4]);
  expect(third.body.hasMore).toBe(false);
});

test("latest mode returns the newest bounded samples in chronological order for live charts", async () => {
  const latest = await request(app).get(`/api/live-shipments/${data.shipmentId}/temperature-history?limit=3&latest=true`).set(authorization);
  expect(latest.status).toBe(200);
  expect(latest.body.records.map(row => row.sequenceNumber)).toEqual([2, 3, 4]);
  expect(latest.body.hasMore).toBe(true);
  expect(latest.body.nextCursor).toBeNull();
  expect((await request(app).get(`/api/live-shipments/${data.shipmentId}/temperature-history?latest=invalid`).set(authorization)).status).toBe(400);
  expect((await request(app).get(`/api/live-shipments/${data.shipmentId}/temperature-history?latest=true&cursor=bad`).set(authorization)).status).toBe(400);
});

test("rejects malformed cursors and requires an authenticated, visible shipment", async () => {
  expect((await request(app).get(`/api/live-shipments/${data.shipmentId}/temperature-history?cursor=bad`).set(authorization)).status).toBe(400);
  expect((await request(app).get(`/api/live-shipments/${data.shipmentId}/temperature-history?limit=1001`).set(authorization)).status).toBe(400);
  expect((await request(app).get(`/api/live-shipments/${data.shipmentId}/temperature-history`)).status).toBe(401);
});
