const http = require("node:http");
const express = require("express");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const { issueToken } = require("../middleware/auth");
const TemperatureLog = require("../models/TemperatureLog");
const TemperatureAlert = require("../models/TemperatureAlert");
const SimulatorOverride = require("../models/SimulatorOverride");
const { attachFieldOperatorWebSocket, PROTOCOL, canReadShipment } = require("../services/fieldOperatorWebSocket");

let server;
let socketService;
let socket;
let fixtureData;
let eventTime;
const oldFlag = process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED;
const oldGrace = process.env.FIELD_OPERATOR_DISCONNECT_GRACE_MINUTES;

const route = [
  { latitude: 9.93, longitude: 76.26 },
  { latitude: 10, longitude: 76.3 },
];
const manager = {
  async initialize() {},
  getAllStatuses() {
    return [{ shipmentId: fixtureData.shipmentId, batchId: fixtureData.batchId, deviceId: "SENSOR-1", route,
      lastReading: null }];
  },
  getShipmentTimeline(shipmentId) {
    if (shipmentId !== fixtureData.shipmentId) throw Object.assign(new Error("No device"), { status: 409 });
    return { shipmentId, batchId: fixtureData.batchId, eventTime: new Date(eventTime), devices: [
      { deviceId: "SENSOR-1", temperature: 5, humidity: 60 },
    ] };
  },
};

function startServer() {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function connectSocket(port, user = fixtureData.reviewer) {
  const token = issueToken({ id: user._id, role: user.role, tokenVersion: user.tokenVersion || 0 });
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws/field-operator?shipmentId=${encodeURIComponent(fixtureData.shipmentId)}`,
    [PROTOCOL, `bearer.${token}`], { headers: { Origin: "http://127.0.0.1:5173" } });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket connection timed out")), 3000);
    socket.once("open", () => { clearTimeout(timeout); resolve(socket); });
    socket.once("error", error => { clearTimeout(timeout); reject(error); });
  });
}

function nextMessage(ws, type, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", onMessage); reject(new Error(`Timed out waiting for ${type}`)); }, timeoutMs);
    const onMessage = data => {
      let parsed;
      try { parsed = JSON.parse(data.toString()); } catch (_) { return; }
      if (parsed.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(parsed);
    };
    ws.on("message", onMessage);
  });
}

async function closeSocketServer() {
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    socket.close();
    await new Promise(resolve => socket.once("close", resolve));
  }
  socket = null;
  if (socketService) await socketService.close();
  socketService = null;
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  server = null;
}

beforeAll(async () => connect());
afterAll(async () => {
  if (oldFlag === undefined) delete process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED;
  else process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = oldFlag;
  if (oldGrace === undefined) delete process.env.FIELD_OPERATOR_DISCONNECT_GRACE_MINUTES;
  else process.env.FIELD_OPERATOR_DISCONNECT_GRACE_MINUTES = oldGrace;
  await close();
});

beforeEach(async () => {
  process.env.FIELD_OPERATOR_DISCONNECT_GRACE_MINUTES = "0.001";
  fixtureData = await fixture();
  eventTime = fixtureData.at(5);
  server = http.createServer(express());
  socketService = attachFieldOperatorWebSocket(server, { manager });
});
afterEach(async () => {
  await closeSocketServer();
  if (mongoose.connection.readyState === 1) {
    await TemperatureLog.deleteMany({ shipmentId: fixtureData.shipmentId });
    await TemperatureAlert.deleteMany({ shipmentId: fixtureData.shipmentId });
    await SimulatorOverride.deleteMany({ shipmentId: fixtureData.shipmentId });
  }
});

test("enforces the existing organization identity mapping for shipment subscriptions", () => {
  const shipment = { distributor: "dist-a", destination: "hospital-a" };
  const batch = { manufacturer: "maker-a" };
  expect(canReadShipment({ role: "admin" }, shipment, batch)).toBe(true);
  expect(canReadShipment({ role: "manufacturer", manufacturer: "maker-a" }, shipment, batch)).toBe(true);
  expect(canReadShipment({ role: "distributor", distributor: "dist-a" }, shipment, batch)).toBe(true);
  expect(canReadShipment({ role: "healthcare", hospital: "hospital-a" }, shipment, batch)).toBe(true);
  expect(canReadShipment({ role: "distributor", distributor: "another-org" }, shipment, batch)).toBe(false);
});

test("authenticates shipment scope and sends INIT with approved policy, saved reading, and simulator route", async () => {
  await TemperatureLog.create([
    { shipmentId: fixtureData.shipmentId, batchId: fixtureData.batchId, deviceId: "SENSOR-1", vehicleId: "TRUCK-1",
      temperature: 4.8, humidity: 59, batteryLevel: 97, location: { lat: 9.94, lng: 76.27 },
      recordedAt: fixtureData.at(2), source: "auto-simulated", status: "Normal" },
    { shipmentId: fixtureData.shipmentId, batchId: fixtureData.batchId, deviceId: "SENSOR-1", vehicleId: "TRUCK-1",
      temperature: 5.1, humidity: 60, batteryLevel: 96, location: { lat: 9.95, lng: 76.28 },
      recordedAt: fixtureData.at(3), source: "manual-override", status: "Alert",
      evaluation: { severity: "CRITICAL", batchQuarantined: true } },
    { shipmentId: fixtureData.shipmentId, batchId: fixtureData.batchId, deviceId: "SENSOR-1", vehicleId: "TRUCK-1",
      temperature: 5.5, humidity: 61, batteryLevel: 96, location: { lat: 9.95, lng: 76.28 },
      recordedAt: fixtureData.at(4), source: "auto-simulated", status: "Normal" },
  ]);
  await TemperatureAlert.create({ alertId: "FIELD-OPERATOR-ALERT-1", shipmentId: fixtureData.shipmentId,
    batchId: fixtureData.batchId, deviceId: "SENSOR-1", metric: "TEMPERATURE", violationType: "HIGH_TEMPERATURE",
    severity: "CRITICAL", status: "ACTIVE", responseState: "OPEN", reason: "Temperature exceeded the approved maximum.",
    currentTemperature: 10, minimumAllowedTemperature: 2, maximumAllowedTemperature: 8,
    timestamp: fixtureData.at(3), excursionStartedAt: fixtureData.at(2), latestReadingAt: fixtureData.at(3),
    excursionDurationMs: 60_000, phase: "QUARANTINED", requiresQualityReview: true });
  const port = await startServer();
  const ws = await connectSocket(port);
  const init = await nextMessage(ws, "INIT");

  expect(ws.protocol).toBe(PROTOCOL);
  expect(init).toMatchObject({
    shipmentId: fixtureData.shipmentId,
    batchId: fixtureData.batchId,
    vaccineType: "Synthetic vaccine",
    policyLimits: { tempMin: 2, tempMax: 8, humidityMin: 40, humidityMax: 80 },
    routeInfo: { origin: null, destination: "hospital-a", routeCoordinates: route },
    shipmentStatus: "In Transit",
    currentState: {
      progress: 58,
      status: "Normal",
      latestReading: { temperature: 5.5, humidity: 61, batteryLevel: 96, gpsLat: 9.95, gpsLng: 76.28 },
      readingHistory: [
        { temperature: 4.8, source: "auto-simulated", status: "Normal", simulationClock: fixtureData.at(2) },
        { temperature: 5.1, source: "manual-override", status: "QUARANTINED", simulationClock: fixtureData.at(3) },
        { temperature: 5.5, source: "auto-simulated", status: "Normal", simulationClock: fixtureData.at(4) },
      ],
      alerts: [expect.objectContaining({ alertId: "FIELD-OPERATOR-ALERT-1", phase: "QUARANTINED",
        excursionStartedAt: fixtureData.at(2), requiresQualityReview: true })],
    },
  });
  expect(init.routeInfo.totalDistanceKm).toBeGreaterThan(0);
  expect(init.currentState.latestReading.deviceId).toBe("SENSOR-1");
  expect(init.currentState.readingHistory.map(reading => reading.simulationClock)).toEqual([
    fixtureData.at(2), fixtureData.at(3), fixtureData.at(4),
  ]);
});

test("publishes scoped reading, alert, and shipment status messages", async () => {
  const port = await startServer();
  const ws = await connectSocket(port);
  await nextMessage(ws, "INIT");

  const readingPromise = nextMessage(ws, "READING");
  await socketService.publishReading(fixtureData.shipmentId, {
    batchId: fixtureData.batchId, deviceId: "SENSOR-1", vehicleId: "TRUCK-1", temperature: 6,
    correlationId: "trace.ws-2",
    humidity: 55, batteryLevel: 94, latitude: 9.94, longitude: 76.27,
    timestamp: fixtureData.at(6), source: "manual-override",
  }, { progress: 58, status: "Normal" });
  expect(await readingPromise).toMatchObject({ type: "READING", shipmentId: fixtureData.shipmentId,
    correlationId: "trace.ws-2", temperature: 6, humidity: 55, battery: 94, gpsLat: 9.94, gpsLng: 76.27, source: "manual-override", progress: 58 });

  const alertPromise = nextMessage(ws, "ALERT");
  socketService.publishAlert({ shipmentId: fixtureData.shipmentId, alertId: "ALERT-1", severity: "CRITICAL",
    correlationId: "trace.ws-alert-1",
    metric: "TEMPERATURE", currentTemperature: 10, breachedLimit: 8, excursionDurationMs: 120000,
    reason: "Temperature exceeded the approved maximum.", timestamp: fixtureData.at(7) });
  expect(await alertPromise).toMatchObject({ type: "ALERT", correlationId: "trace.ws-alert-1", alertId: "ALERT-1", severity: "critical",
    metric: "temperature", value: 10, limit: 8, duration: 2 });

  const statusPromise = nextMessage(ws, "STATUS_CHANGE");
  socketService.publishStatusChange(fixtureData.shipmentId, { newStatus: "Supplied to Vaccination Center",
    reason: "Distributor recorded supply.", simulationClock: fixtureData.at(8) });
  expect(await statusPromise).toMatchObject({ type: "STATUS_CHANGE", newStatus: "Supplied to Vaccination Center",
    reason: "Distributor recorded supply.", simulationClock: fixtureData.at(8) });
});

test("routes admin override and release commands through the audited override engine", async () => {
  process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = "true";
  const port = await startServer();
  const ws = await connectSocket(port);
  await nextMessage(ws, "INIT");

  const appliedPromise = nextMessage(ws, "OVERRIDE_RESULT");
  ws.send(JSON.stringify({ type: "OVERRIDE", requestId: "request-1", shipmentId: fixtureData.shipmentId,
    temperature: 10, behavior: "hold", durationMinutes: 10, rampDuration: 0, expiresInMs: 600000, reason: "Synthetic demo test" }));
  const applied = await appliedPromise;
  expect(applied).toMatchObject({ requestId: "request-1", command: "OVERRIDE", status: "accepted",
    activeOverride: { status: "ACTIVE", targetTemperature: 10 } });
  const saved = await SimulatorOverride.findOne({ shipmentId: fixtureData.shipmentId, status: "ACTIVE" }).lean();
  expect(saved.createdBy.toString()).toBe(fixtureData.reviewer._id.toString());

  const releasedPromise = nextMessage(ws, "OVERRIDE_RESULT");
  ws.send(JSON.stringify({ type: "RELEASE_OVERRIDE", requestId: "request-2", shipmentId: fixtureData.shipmentId }));
  expect(await releasedPromise).toMatchObject({ requestId: "request-2", command: "RELEASE_OVERRIDE", status: "accepted", activeOverride: null });
  expect((await SimulatorOverride.findOne({ overrideId: saved.overrideId })).status).toBe("RELEASED");
});

test("releases a connection-owned override only after the simulated disconnect grace period", async () => {
  process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = "true";
  process.env.FIELD_OPERATOR_DISCONNECT_GRACE_MINUTES = "0.001";
  const port = await startServer();
  const ws = await connectSocket(port);
  await nextMessage(ws, "INIT");
  const appliedPromise = nextMessage(ws, "OVERRIDE_RESULT");
  ws.send(JSON.stringify({ type: "OVERRIDE", shipmentId: fixtureData.shipmentId, temperature: 10,
    behavior: "hold", durationMinutes: 1, rampDuration: 0, expiresInMs: 60000, reason: "Grace test" }));
  const applied = await appliedPromise;
  expect(applied.status).toBe("accepted");
  ws.close();
  await new Promise(resolve => setTimeout(resolve, 30));
  eventTime = new Date(+new Date(eventTime) + 60_000).toISOString();

  const deadline = Date.now() + 3000;
  let saved;
  while (Date.now() < deadline) {
    saved = await SimulatorOverride.findOne({ overrideId: applied.activeOverride.overrideId }).lean();
    if (saved?.status === "RELEASED") break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  expect(saved.status).toBe("RELEASED");
});

test("rejects a client without the access-token subprotocol", async () => {
  const port = await startServer();
  const invalid = new WebSocket(`ws://127.0.0.1:${port}/ws/field-operator?shipmentId=${fixtureData.shipmentId}`, [PROTOCOL]);
  const response = await new Promise(resolve => invalid.once("unexpected-response", (_request, response) => resolve(response.statusCode)));
  expect(response).toBe(401);
});
