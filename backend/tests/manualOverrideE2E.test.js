jest.mock("../services/blockchainService", () => new Proxy({}, {
  get: (_, key) => key === "then" ? undefined : jest.fn().mockResolvedValue(null),
}));
jest.mock("../services/aiService", () => ({
  getTelemetryAnomaly: jest.fn().mockResolvedValue({ status: "NORMAL", label: "NORMAL", is_anomaly: false,
    advisory_only: true, reason: "Advisory service is isolated in this policy-workflow test.", contributions: [] }),
}));

const express = require("express");
const request = require("supertest");
const { randomBytes } = require("node:crypto");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const SimulatorDevice = require("../models/SimulatorDevice");
const SimulatorOverride = require("../models/SimulatorOverride");
const SimulatorOverrideAudit = require("../models/SimulatorOverrideAudit");
const TemperatureLog = require("../models/TemperatureLog");
const TemperatureAlert = require("../models/TemperatureAlert");
const Notification = require("../models/Notification");
const ColdChainAudit = require("../models/ColdChainAudit");
const TelemetryState = require("../models/TelemetryState");
const User = require("../models/user");
const { issueToken } = require("../middleware/auth");
const { VirtualDeviceSimulator } = require("../services/iotSimulator");
const { simulatorManager } = require("../controllers/simulatorController");
const simulatorRoutes = require("../routes/simulatorRoutes");
const alertRoutes = require("../routes/alertRoutes");
const liveShipmentRoutes = require("../routes/liveShipmentRoutes");
const { connect, close, fixture } = require("./helpers/coldChainFixture");

const previousApiKey = process.env.TEMP_API_KEY;
const previousIngestUrl = process.env.SIMULATOR_INGEST_URL;
const testApiKey = randomBytes(24).toString("hex");
process.env.TEMP_API_KEY = testApiKey;
const temperatureRoutes = require("../routes/temperatureRoutes");
const app = express();
app.use(express.json());
app.use("/api/simulator", simulatorRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/live-shipments", liveShipmentRoutes);
app.use("/api/temperature", temperatureRoutes);

const scenarios = [
  { label: "high temperature", violationType: "HIGH_TEMPERATURE", targetTemperature: 12 },
  { label: "low humidity", violationType: "LOW_HUMIDITY", targetHumidity: 20 },
];

let f;
let auth;
let apiServer;
let priorOverrideFlag;
let deviceId;
let config;

function bearer(user) {
  return { Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` };
}

beforeAll(async () => {
  await connect();
  apiServer = await new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  process.env.SIMULATOR_INGEST_URL = `http://127.0.0.1:${apiServer.address().port}/api/temperature/ingest`;
}, 60000);
afterAll(async () => {
  apiServer?.closeAllConnections?.();
  if (apiServer) await new Promise(resolve => apiServer.close(resolve));
  if (previousApiKey === undefined) delete process.env.TEMP_API_KEY; else process.env.TEMP_API_KEY = previousApiKey;
  if (previousIngestUrl === undefined) delete process.env.SIMULATOR_INGEST_URL; else process.env.SIMULATOR_INGEST_URL = previousIngestUrl;
  await close();
});

beforeEach(async () => {
  priorOverrideFlag = process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED;
  process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = "true";
  simulatorManager.clear();
  await Promise.all([
    SimulatorDevice.deleteMany({}), SimulatorOverride.deleteMany({}), SimulatorOverrideAudit.collection.deleteMany({}),
    TemperatureLog.deleteMany({}), TemperatureAlert.deleteMany({}), Notification.deleteMany({}),
    ColdChainAudit.collection.deleteMany({}), TelemetryState.deleteMany({}),
  ]);

  f = await fixture();
  const [manufacturer, otherManufacturer, distributor, hospital, nonReviewerAdmin] = await User.create([
    { email: `${f.batchId}-maker@test`, password: "test", role: "manufacturer", manufacturer: "maker-a" },
    { email: `${f.batchId}-other-maker@test`, password: "test", role: "manufacturer", manufacturer: "maker-b" },
    { email: `${f.batchId}-distributor@test`, password: "test", role: "distributor", distributor: "dist-a" },
    { email: `${f.batchId}-hospital@test`, password: "test", role: "healthcare", hospital: "hospital-a" },
    { email: `${f.batchId}-admin-no-review@test`, password: "test", role: "admin" },
  ]);
  auth = {
    reviewer: bearer(f.reviewer),
    manufacturer: bearer(manufacturer),
    otherManufacturer: bearer(otherManufacturer),
    distributor: bearer(distributor),
    hospital: bearer(hospital),
    nonReviewerAdmin: bearer(nonReviewerAdmin),
  };
  deviceId = `E2E-${f.batchId}`;
  config = {
    deviceId, batchId: f.batchId, shipmentId: f.shipmentId, vehicleId: "SYNTHETIC-TRUCK-E2E",
    seed: `phase-6-${f.batchId}`, startTime: f.at(0), tickIntervalMs: 60000,
    temperatureRange: { min: 2, max: 8 },
    route: [{ latitude: 9, longitude: 76 }, { latitude: 10, longitude: 77 }],
  };
});

afterEach(() => {
  simulatorManager.clear();
  if (priorOverrideFlag === undefined) delete process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED;
  else process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = priorOverrideFlag;
  jest.restoreAllMocks();
});

async function tick() {
  const result = await request(app).post(`/api/simulator/${encodeURIComponent(deviceId)}/tick`).set(auth.reviewer);
  if (result.status !== 200) throw new Error(`Simulator tick failed with HTTP ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function verifyNotificationRouting(alert) {
  const expected = [
    ["admin", ""], ["manufacturer", "maker-a"], ["distributor", "dist-a"], ["healthcare", "hospital-a"],
  ];
  const notifications = await Notification.find({ alertId: alert.alertId }).lean();
  for (const [role, refKey] of expected) {
    expect(notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientRole: role, recipientRefKey: refKey, alertId: alert.alertId }),
    ]));
  }
  for (const userAuth of [auth.reviewer, auth.manufacturer, auth.distributor, auth.hospital]) {
    const response = await request(app).get(`/api/alerts?batchId=${encodeURIComponent(f.batchId)}`).set(userAuth);
    expect(response.status).toBe(200);
    expect(response.body.alerts.map(item => item.alertId)).toContain(alert.alertId);
    const inbox = await request(app).get("/api/alerts/notifications").set(userAuth);
    expect(inbox.status).toBe(200);
    expect(inbox.body.notifications.map(item => item.alertId)).toContain(alert.alertId);
  }
  const outOfScope = await request(app).get(`/api/alerts?batchId=${encodeURIComponent(f.batchId)}`).set(auth.otherManufacturer);
  expect(outOfScope.status).toBe(200);
  expect(outOfScope.body.alerts).toHaveLength(0);
}

test.each(scenarios)("manual $label excursion follows the real policy, alert, truck-data, review, and recovery path", async scenario => {
  const createdDevice = await request(app).post("/api/simulator/devices").set(auth.reviewer).send(config);
  expect(createdDevice.status).toBe(201);

  const expectedSimulator = new VirtualDeviceSimulator(config);
  const expectedAutomatic = Array.from({ length: 4 }, () => expectedSimulator.tick()).at(-1);
  const overrideRequest = {
    shipmentId: f.shipmentId,
    behavior: "hold",
    holdDuration: 5,
    expiresInMs: 600000,
    reason: `Synthetic Phase 6 ${scenario.label} demonstration`,
    ...(scenario.targetTemperature === undefined ? {} : { targetTemperature: scenario.targetTemperature }),
    ...(scenario.targetHumidity === undefined ? {} : { targetHumidity: scenario.targetHumidity }),
  };
  const createdOverride = await request(app).post("/api/simulator/overrides").set(auth.reviewer).send(overrideRequest);
  expect(createdOverride.status).toBe(201);
  const overrideId = createdOverride.body.override.overrideId;

  const manualTicks = [];
  for (let minute = 0; minute <= 2; minute += 1) manualTicks.push(await tick());
  expect(manualTicks.every(item => item.reading.source === "manual-override" && item.reading.overrideId === overrideId)).toBe(true);

  const alert = await TemperatureAlert.findOne({ shipmentId: f.shipmentId, violationType: scenario.violationType, requiresQualityReview: true }).lean();
  expect(alert).toMatchObject({ phase: "QUARANTINED", severity: "CRITICAL", context: { source: "manual-override", overrideId } });
  await verifyNotificationRouting(alert);

  const liveDuringHold = await request(app).get(`/api/live-shipments?shipmentId=${encodeURIComponent(f.shipmentId)}`).set(auth.reviewer);
  expect(liveDuringHold.status).toBe(200);
  const liveShipment = liveDuringHold.body.shipments[0];
  expect(liveShipment.shipmentId).toBe(f.shipmentId);
  expect(liveShipment.batchColdChainHoldAlertIds).toContain(alert.alertId);
  expect(liveShipment.latestTelemetry.source).toBe("manual-override");
  if (scenario.targetTemperature !== undefined) expect(Math.abs(liveShipment.latestTelemetry.temperature - scenario.targetTemperature)).toBeLessThanOrEqual(0.1);
  else expect(liveShipment.latestTelemetry.temperature).toBeGreaterThanOrEqual(2);
  if (scenario.targetHumidity !== undefined) expect(Math.abs(liveShipment.latestTelemetry.humidity - scenario.targetHumidity)).toBeLessThanOrEqual(0.4);
  else expect(liveShipment.latestTelemetry.humidity).toBeGreaterThanOrEqual(40);
  // LiveShipmentVisualizer maps these persisted hold fields to a red, stationary truck;
  // its UI contract is covered in LiveShipmentVisualizer.test.js.

  const acknowledge = await request(app).patch(`/api/alerts/${alert.alertId}/acknowledge`).set(auth.manufacturer)
    .send({ reason: `Manufacturer acknowledged synthetic ${scenario.label} excursion` });
  expect(acknowledge.status).toBe(200);
  const action = await request(app).patch(`/api/alerts/${alert.alertId}/action-taken`).set(auth.manufacturer)
    .send({ action: "inspect", reason: `Inspected synthetic shipment for ${scenario.label}` });
  expect(action.status).toBe(200);
  expect((await request(app).patch(`/api/alerts/${alert.alertId}/resolve`).set(auth.reviewer)
    .send({ reason: "Premature clear must fail", asOf: f.at(2) })).status).toBe(409);

  const released = await request(app).delete(`/api/simulator/overrides/${overrideId}`).set(auth.reviewer)
    .send({ reason: "End synthetic override and resume deterministic automatic readings" });
  expect(released.status).toBe(200);
  expect(released.body.override).toMatchObject({ status: "RELEASED", mode: "auto" });

  const recoveryTick = await tick();
  expect(recoveryTick.reading).toMatchObject({ source: "auto-simulated", overrideId: null });
  expect(recoveryTick.reading.temperature).toBe(expectedAutomatic.temperature);
  expect(recoveryTick.reading.humidity).toBe(expectedAutomatic.humidity);
  const savedRecovery = await TemperatureLog.findOne({ shipmentId: f.shipmentId }).sort({ sequenceNumber: -1 }).lean();
  expect(savedRecovery).toMatchObject({ source: "auto-simulated", temperature: expectedAutomatic.temperature, humidity: expectedAutomatic.humidity });

  const liveAfterRecovery = await request(app).get(`/api/live-shipments?shipmentId=${encodeURIComponent(f.shipmentId)}`).set(auth.reviewer);
  expect(liveAfterRecovery.body.shipments[0].batchColdChainHoldAlertIds).toContain(alert.alertId);
  expect((await TemperatureAlert.findById(alert._id)).requiresQualityReview).toBe(true);
  expect((await request(app).patch(`/api/alerts/${alert.alertId}/resolve`).set(auth.reviewer)
    .send({ reason: "Clear requires a separate quality review", asOf: f.at(3) })).status).toBe(409);

  const review = await request(app).patch(`/api/alerts/${alert.alertId}/review`).set(auth.reviewer)
    .send({ reason: `Reviewed normal recovery after ${scenario.label} test`, asOf: f.at(3) });
  expect(review.status).toBe(200);
  const resolutionNote = `Synthetic ${scenario.label} excursion reviewed; normal automatic recovery verified.`;
  const resolved = await request(app).patch(`/api/alerts/${alert.alertId}/resolve`).set(auth.reviewer)
    .send({ reason: resolutionNote, asOf: f.at(3) });
  expect(resolved.status).toBe(200);
  expect(resolved.body.alert).toMatchObject({ phase: "CLEARED", requiresQualityReview: false,
    responseState: "RESOLVED", responseResolvedNote: resolutionNote });

  const liveCleared = await request(app).get(`/api/live-shipments?shipmentId=${encodeURIComponent(f.shipmentId)}`).set(auth.reviewer);
  expect(liveCleared.body.shipments[0].batchColdChainHoldAlertIds).not.toContain(alert.alertId);
  expect(await SimulatorOverrideAudit.countDocuments({ overrideId, action: { $in: ["STARTED", "RELEASED"] } })).toBe(2);
  const responseAudit = await ColdChainAudit.find({ alertId: alert.alertId }).lean();
  expect(responseAudit.map(entry => entry.action)).toEqual(expect.arrayContaining([
    "RESPONSE_ACKNOWLEDGED", "RESPONSE_ACTION_TAKEN", "QUALITY_REVIEW", "CLEAR_AUTHORIZED", "RESPONSE_RESOLVED",
  ]));
});
