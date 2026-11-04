jest.mock("../services/blockchainService", () => ({
  logLifecycleEventOnChain: jest.fn().mockResolvedValue(null),
  recordOnBlockchain: jest.fn().mockResolvedValue(null),
  updateBatchStatusOnChain: jest.fn().mockResolvedValue(null),
  extractHash: jest.fn().mockReturnValue(""),
}));
jest.mock("../services/aiService", () => ({
  getTelemetryAnomaly: jest.fn().mockResolvedValue({ status: "NORMAL", label: "NORMAL", is_anomaly: false,
    advisory_only: true, reason: "Advisory service is isolated in this WebSocket workflow test.", contributions: [] }),
}));

const http = require("node:http");
const express = require("express");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const request = require("supertest");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const { issueToken, authenticate } = require("../middleware/auth");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const SimulatorDevice = require("../models/SimulatorDevice");
const TemperatureLog = require("../models/TemperatureLog");
const TemperatureAlert = require("../models/TemperatureAlert");
const TelemetryState = require("../models/TelemetryState");
const { DurableSimulatorManager } = require("../services/durableSimulator");
const { persistSimulationReading } = require("../services/telemetryService");
const { verifyVaccineDetails } = require("../controllers/distributionController");
const { attachFieldOperatorWebSocket, PROTOCOL } = require("../services/fieldOperatorWebSocket");

const oldOverrideFlag = process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED;
let server;
let socketService;
let socket;
let socketMessages = [];
let manager;
let data;
let deviceId;

function startServer() {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function connectSocket(port) {
  const token = issueToken({ id: data.reviewer._id, role: data.reviewer.role, tokenVersion: data.reviewer.tokenVersion || 0 });
  socket = new WebSocket(`ws://127.0.0.1:${port}/ws/field-operator?shipmentId=${encodeURIComponent(data.shipmentId)}`,
    [PROTOCOL, `bearer.${token}`], { headers: { Origin: "http://127.0.0.1:5173" } });
  socketMessages = [];
  socket.on("message", raw => { try { socketMessages.push(JSON.parse(raw.toString())); } catch (_) { /* diagnostics only */ } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket connection timed out")), 3000);
    socket.once("open", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
}

function nextMessage(ws, type, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", onMessage); reject(new Error(`Timed out waiting for ${type}; observed=${JSON.stringify(socketMessages)}`)); }, timeoutMs);
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch (_) { return; }
      if (message.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(message);
    };
    ws.on("message", onMessage);
  });
}

async function prepareDevice() {
  manager = new DurableSimulatorManager();
  deviceId = `FIELD-LIVE-${data.batchId}`;
  await manager.createDevice({
    deviceId,
    vehicleId: "SYNTHETIC-TRUCK-LIVE",
    batchId: data.batchId,
    shipmentId: data.shipmentId,
    scenario: "NORMAL",
    seed: `phase-9-${data.batchId}`,
    startTime: data.at(0),
    tickIntervalMs: 60_000,
    route: [
      { latitude: 9.93, longitude: 76.26 },
      { latitude: 10, longitude: 76.3 },
    ],
    temperatureRange: { min: 2, max: 8 },
    initialBatteryLevel: 100,
  }, data.reviewer._id);

  const app = express();
  app.use(express.json());
  app.patch("/verify/:shipmentId", authenticate, verifyVaccineDetails);
  server = http.createServer(app);
  socketService = attachFieldOperatorWebSocket(server, { manager });
  return startServer();
}

async function cleanup() {
  if (socketService) await socketService.close();
  socketService = null;
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    socket.close();
    await new Promise(resolve => socket.once("close", resolve));
  }
  socket = null;
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  server = null;
  manager?.clear();
  manager = null;
  if (mongoose.connection.readyState === 1 && data) {
    await Promise.all([
      SimulatorDevice.deleteMany({ deviceId }),
      TemperatureLog.deleteMany({ shipmentId: data.shipmentId }),
      TemperatureAlert.deleteMany({ shipmentId: data.shipmentId }),
      TelemetryState.deleteMany({ batchId: data.batchId }),
    ]);
  }
}

beforeAll(connect);
afterAll(async () => {
  if (oldOverrideFlag === undefined) delete process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED;
  else process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = oldOverrideFlag;
  await cleanup();
  await close();
});

beforeEach(async () => {
  process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = "true";
  data = await fixture({ policy: { excursionDurationMs: 1000 } });
});

afterEach(cleanup);

test("publishes saved shipment workflow transitions to the subscribed field panel", async () => {
  const batch = await Batch.findById(data.batch._id);
  Object.assign(batch, { releaseVisibleToExternal: true, productionApproved: true, labApproved: true, reportStatus: "Reported" });
  await batch.save();
  const shipment = await Shipment.findOne({ shipmentId: data.shipmentId });
  shipment.status = "Pending";
  shipment.statusHistory = [];
  shipment.quantity = 100;
  shipment.vaccineType = batch.vaccineType;
  await shipment.save();

  const port = await prepareDevice();
  const ws = await connectSocket(port);
  await nextMessage(ws, "INIT");
  const statusPromise = nextMessage(ws, "STATUS_CHANGE");
  const token = issueToken({ id: data.reviewer._id, role: data.reviewer.role, tokenVersion: data.reviewer.tokenVersion || 0 });
  const response = await request(server).patch(`/verify/${encodeURIComponent(data.shipmentId)}`)
    .set("Authorization", `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(response.body.shipment.status).toBe("Verified");
  await expect(statusPromise).resolves.toMatchObject({
    type: "STATUS_CHANGE",
    newStatus: "Verified",
    reason: "Distributor verified the shipment against its batch record.",
  });
});

test("a persisted manual temperature excursion streams READING and ALERT and marks the shipment quarantined", async () => {
  const port = await prepareDevice();
  const ws = await connectSocket(port);
  await nextMessage(ws, "INIT");

  const overridePromise = nextMessage(ws, "OVERRIDE_RESULT");
  ws.send(JSON.stringify({ type: "OVERRIDE", requestId: "phase-9-override", temperature: 12,
    behavior: "hold", durationMinutes: 2, rampDuration: 0, expiresInMs: 120_000, reason: "Phase 9 synthetic acceptance test" }));
  await expect(overridePromise).resolves.toMatchObject({ command: "OVERRIDE", status: "accepted" });

  const firstReadingPromise = nextMessage(ws, "READING");
  const warningPromise = nextMessage(ws, "ALERT");
  const readingPublisher = jest.spyOn(socketService, "publishReading");
  const tickResult = await manager.tickOnce(deviceId, persistSimulationReading, data.reviewer._id);
  const publishedCount = readingPublisher.mock.calls.length
    ? await readingPublisher.mock.results.at(-1).value : 0;
  if (publishedCount !== 1) {
    throw new Error(`Persisted telemetry did not reach the connected shipment socket: ${JSON.stringify({
      result: tickResult.persistedReading, publishCalls: readingPublisher.mock.calls.length,
      publishResult: publishedCount, socketMessages,
    })}`);
  }
  const [firstReading, warning] = await Promise.all([firstReadingPromise, warningPromise]);
  expect(firstReading.temperature).toBeGreaterThan(8);
  expect(firstReading.source).toBe("manual");
  expect(warning).toMatchObject({ severity: "warning", metric: "temperature", limit: 8 });

  const criticalReadingPromise = nextMessage(ws, "READING");
  const criticalAlertPromise = nextMessage(ws, "ALERT");
  await manager.tickOnce(deviceId, persistSimulationReading, data.reviewer._id);
  const [reading, alert] = await Promise.all([criticalReadingPromise, criticalAlertPromise]);

  expect(reading).toMatchObject({ status: "QUARANTINED", source: "manual" });
  expect(reading.temperature).toBeGreaterThan(8);
  expect(alert).toMatchObject({ severity: "critical", metric: "temperature", limit: 8, duration: 1 });
  expect(alert.alertId).toBe(firstReading.alertsTriggered[0]);
  expect((await Shipment.findOne({ shipmentId: data.shipmentId }).lean()).coldChainStatus).toMatch(/quarantin/i);
  expect(await TemperatureAlert.exists({ shipmentId: data.shipmentId, severity: "CRITICAL", requiresQualityReview: true })).toBeTruthy();
  expect(await TemperatureLog.countDocuments({ shipmentId: data.shipmentId, source: "manual" })).toBe(2);
});
