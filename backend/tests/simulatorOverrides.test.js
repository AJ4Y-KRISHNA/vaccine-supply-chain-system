const express = require("express");
const request = require("supertest");
const { simulatorManager } = require("../controllers/simulatorController");
const simulatorRoutes = require("../routes/simulatorRoutes");
const Device = require("../models/SimulatorDevice");
const SimulatorOverride = require("../models/SimulatorOverride");
const SimulatorOverrideAudit = require("../models/SimulatorOverrideAudit");
const TemperatureLog = require("../models/TemperatureLog");
const TemperatureAlert = require("../models/TemperatureAlert");
const User = require("../models/user");
const { VirtualDeviceSimulator } = require("../services/iotSimulator");
const { simulationReadingToTemperatureLog, persistSimulationReading } = require("../services/telemetryService");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const { issueToken } = require("../middleware/auth");

const app = express();
app.use(express.json());
app.use("/api/simulator", simulatorRoutes);

let f;
let adminAuth;
let manufacturerAuth;
let previousFlag;
const deviceConfig = (fixtureData, deviceId = `IOT-${fixtureData.batchId}`, seed = "override-seed") => ({
  deviceId, batchId: fixtureData.batchId, shipmentId: fixtureData.shipmentId, vehicleId: "TRUCK-OVERRIDE",
  seed, startTime: fixtureData.at(0), tickIntervalMs: 60000,
  temperatureRange: { min: 2, max: 8 },
  route: [{ latitude: 9, longitude: 76 }, { latitude: 10, longitude: 77 }],
});
const makeOverride = (shipmentId, extra = {}) => ({ shipmentId, targetTemperature: 12, behavior: "hold",
  holdDuration: 5, expiresInMs: 600000, reason: "Synthetic test override", ...extra });

beforeAll(connect, 15000);
afterAll(close);
beforeEach(async () => {
  previousFlag = process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED;
  process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = "true";
  simulatorManager.clear();
  await Promise.all([Device.deleteMany({}), SimulatorOverride.deleteMany({}), SimulatorOverrideAudit.collection.deleteMany({}),
    TemperatureLog.deleteMany({}), TemperatureAlert.deleteMany({})]);
  f = await fixture();
  adminAuth = { Authorization: `Bearer ${issueToken({ id: f.reviewer._id, role: "admin" })}` };
  const manufacturer = await User.create({ email: "maker-a@example.test", password: "test", role: "manufacturer", manufacturer: "maker-a" });
  manufacturerAuth = { Authorization: `Bearer ${issueToken({ id: manufacturer._id, role: "manufacturer" })}` };
  await simulatorManager.createDevice(deviceConfig(f), f.reviewer._id);
});
afterEach(async () => {
  simulatorManager.clear();
  if (previousFlag === undefined) delete process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED;
  else process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = previousFlag;
  jest.restoreAllMocks();
});

test("manual override endpoints are feature-flagged and admin-only", async () => {
  delete process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED;
  const disabled = await request(app).get("/api/simulator/presets").set(adminAuth);
  expect(disabled.status).toBe(404);
  expect(disabled.body.code).toBe("SIMULATOR_OVERRIDES_DISABLED");
  process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED = "true";
  expect((await request(app).get("/api/simulator/presets").set(manufacturerAuth)).status).toBe(403);
  expect((await request(app).post("/api/simulator/overrides").set(manufacturerAuth).send(makeOverride(f.shipmentId))).status).toBe(403);
});

test("preset catalogue is data-driven and validation rejects missing or physically invalid values", async () => {
  const response = await request(app).get("/api/simulator/presets").set(adminAuth);
  expect(response.status).toBe(200);
  expect(response.body.presets.map(preset => preset.name)).toEqual([
    "Refrigeration failure", "Door left open", "Freezing risk", "Low humidity", "Sensor fault",
  ]);
  expect(response.body.expiry).toMatchObject({ default: 1800000, max: 86400000 });
  expect((await request(app).post("/api/simulator/overrides").set(adminAuth).send({ shipmentId: f.shipmentId, reason: "No target" })).status).toBe(400);
  expect((await request(app).post("/api/simulator/overrides").set(adminAuth).send(makeOverride(f.shipmentId, { targetTemperature: 60.1 }))).status).toBe(400);
  expect((await request(app).post("/api/simulator/overrides").set(adminAuth).send(makeOverride(f.shipmentId, { targetHumidity: -1 }))).status).toBe(400);
  expect((await request(app).post("/api/simulator/overrides").set(adminAuth).send(makeOverride(f.shipmentId, { expiresInMs: 86400001 }))).status).toBe(400);
});

test("only devices for the selected shipment receive a manual reading; automatic seeded values stay unchanged", async () => {
  const second = await fixture();
  const secondConfig = deviceConfig(second, `IOT-${second.batchId}`, "other-shipment-seed");
  await simulatorManager.createDevice(secondConfig, f.reviewer._id);
  const expected = new VirtualDeviceSimulator(secondConfig).tick();
  const overrideResponse = await request(app).post("/api/simulator/overrides").set(adminAuth).send(makeOverride(f.shipmentId));
  expect(overrideResponse.status).toBe(201);
  const overrideId = overrideResponse.body.override.overrideId;
  const persist = jest.fn().mockResolvedValue({ _id: "mock-log" });
  const manual = await simulatorManager.tickOnce(`IOT-${f.batchId}`, persist, f.reviewer._id);
  const automatic = await simulatorManager.tickOnce(`IOT-${second.batchId}`, persist, f.reviewer._id);
  expect(manual.reading).toMatchObject({ source: "manual-override", overrideId, operatorUserId: String(f.reviewer._id) });
  expect(Math.abs(manual.reading.temperature - 12)).toBeLessThanOrEqual(0.1);
  expect(manual.reading.simulation.source).toBe("software-iot-simulator");
  expect(automatic.reading).toMatchObject({ source: "auto-simulated", overrideId: null,
    temperature: expected.temperature, humidity: expected.humidity, batteryLevel: expected.batteryLevel,
    latitude: expected.latitude, longitude: expected.longitude });
  expect(persist).toHaveBeenNthCalledWith(1, expect.objectContaining({ source: "manual-override", overrideId }));
  expect(persist).toHaveBeenNthCalledWith(2, expect.objectContaining({ source: "auto-simulated" }));
  expect(simulationReadingToTemperatureLog(manual.reading)).toMatchObject({ source: "manual", overrideId, operatorUserId: String(f.reviewer._id) });
});

test("ramp is deterministic and expiry returns the device to its original automatic sequence", async () => {
  const config = deviceConfig(f);
  const baseline = new VirtualDeviceSimulator(config);
  const initial = baseline.tick();
  baseline.tick();
  const expectedAfterExpiry = baseline.tick();
  const created = await request(app).post("/api/simulator/overrides").set(adminAuth)
    .send(makeOverride(f.shipmentId, { behavior: "ramp", rampDuration: 1, holdDuration: 1, expiresInMs: 120000 }));
  expect(created.status).toBe(201);
  const persist = jest.fn().mockResolvedValue({ _id: "persisted" });
  const first = await simulatorManager.tickOnce(config.deviceId, persist, f.reviewer._id);
  expect(first.reading.source).toBe("manual-override");
  expect(Math.abs(first.reading.temperature - initial.temperature)).toBeLessThanOrEqual(0.1);
  await simulatorManager.tickOnce(config.deviceId, persist, f.reviewer._id);
  const automatic = await simulatorManager.tickOnce(config.deviceId, persist, f.reviewer._id);
  expect(automatic.reading).toMatchObject({ source: "auto-simulated", temperature: expectedAfterExpiry.temperature, humidity: baseline.lastReading.humidity });
  const saved = await SimulatorOverride.findOne({ overrideId: created.body.override.overrideId }).lean();
  expect(saved).toMatchObject({ mode: "auto", status: "EXPIRED" });
  expect((await SimulatorOverrideAudit.find({ overrideId: saved.overrideId }).sort({ action: 1 }).lean()).map(entry => entry.action)).toEqual(["EXPIRED", "STARTED"]);
});

test("modify and release are audited, release is idempotent, and automatic recovery does not clear cold-chain holds", async () => {
  const created = await request(app).post("/api/simulator/overrides").set(adminAuth).send(makeOverride(f.shipmentId));
  const id = created.body.override.overrideId;
  const modified = await request(app).patch(`/api/simulator/overrides/${id}`).set(adminAuth)
    .send({ targetTemperature: 11, reason: "Change synthetic test target" });
  expect(modified.status).toBe(200);
  expect(modified.body.override.createdAt).toBe(created.body.override.createdAt);
  const release = await request(app).delete(`/api/simulator/overrides/${id}`).set(adminAuth).send({ reason: "Return to auto" });
  expect(release.status).toBe(200);
  expect(release.body.override).toMatchObject({ mode: "auto", status: "RELEASED" });
  expect((await request(app).delete(`/api/simulator/overrides/${id}`).set(adminAuth).send({})).body.override.alreadyClosed).toBe(true);
  expect((await SimulatorOverrideAudit.find({ overrideId: id }).sort({ eventTime: 1 }).lean()).map(entry => entry.action)).toEqual(["STARTED", "CHANGED", "RELEASED"]);
  const tick = await simulatorManager.tickOnce(`IOT-${f.batchId}`, jest.fn().mockResolvedValue({ _id: "auto" }), f.reviewer._id);
  expect(tick.reading.source).toBe("auto-simulated");
  const after = await TemperatureAlert.findOne({ batchId: f.batchId, requiresQualityReview: true }).lean();
  expect(after).toBeNull(); // No alert was created by the override control itself.
});

test("manual sensor values go through existing policy evaluation and can quarantine per approved policy", async () => {
  const created = await request(app).post("/api/simulator/overrides").set(adminAuth)
    .send(makeOverride(f.shipmentId, { holdDuration: 3, expiresInMs: 300000 }));
  expect(created.status).toBe(201);
  for (let index = 0; index < 3; index += 1) await simulatorManager.tickOnce(`IOT-${f.batchId}`, persistSimulationReading, f.reviewer._id);
  const logs = await TemperatureLog.find({ batchId: f.batchId }).sort({ sequenceNumber: 1 }).lean();
  expect(logs).toHaveLength(3);
  expect(logs.every(log => log.source === "manual" && log.overrideId === created.body.override.overrideId && log.operatorUserId === String(f.reviewer._id))).toBe(true);
  const alert = await TemperatureAlert.findOne({ batchId: f.batchId, requiresQualityReview: true }).lean();
  expect(alert).toMatchObject({ phase: "QUARANTINED", context: expect.objectContaining({ source: "manual-override", overrideId: created.body.override.overrideId }) });
});

test("sensor-fault preset suppresses measured samples and invokes the existing missing-telemetry evaluator", async () => {
  const created = await request(app).post("/api/simulator/overrides").set(adminAuth).send({
    shipmentId: f.shipmentId, presetId: "sensor-fault", expiresInMs: 1200000, reason: "Synthetic sensor fault test",
  });
  expect(created.status).toBe(201);
  const persist = jest.fn();
  const first = await simulatorManager.tickOnce(`IOT-${f.batchId}`, persist, f.reviewer._id);
  expect(first.reading).toMatchObject({ source: "manual-override", simulation: { sensorFault: true }, temperature: null, humidity: null });
  expect(persist).not.toHaveBeenCalled();
  await simulatorManager.tickOnce(`IOT-${f.batchId}`, persist, f.reviewer._id);
  const alert = await TemperatureAlert.findOne({ batchId: f.batchId, metric: "RELIABILITY" }).lean();
  expect(alert?.reason).toMatch(/sensor reading missing/i);
});

test("an override created during ingestion applies to the next sample, not the pending sample", async () => {
  let finishPersistence;
  const pendingTick = simulatorManager.tickOnce(`IOT-${f.batchId}`, () => new Promise(resolve => { finishPersistence = resolve; }), f.reviewer._id);
  while (!finishPersistence) await new Promise(resolve => setTimeout(resolve, 2));
  let requestSettled = false;
  const pendingRequest = request(app).post("/api/simulator/overrides").set(adminAuth).send(makeOverride(f.shipmentId))
    .then(response => { requestSettled = true; return response; });
  // Wait for the observable response, not a 30 ms machine-speed assumption.
  // Persistence remains unresolved throughout: a lock held over ingestion
  // would still prevent this request from settling and fail the bounded check.
  const responseDeadline = Date.now() + 2000;
  while (!requestSettled && Date.now() < responseDeadline) await new Promise(resolve => setTimeout(resolve, 10));
  // The sample is already selected and tagged before network ingestion. Do not
  // hold the batch lock over HTTP, since the receiver evaluates this same batch.
  expect(requestSettled).toBe(true);
  const response = await pendingRequest;
  expect(response.status).toBe(201);
  finishPersistence({ _id: "first-tick" });
  const tick = await pendingTick;
  expect(tick.reading.source).toBe("auto-simulated");
  const next = await simulatorManager.tickOnce(`IOT-${f.batchId}`, jest.fn().mockResolvedValue({ _id: "second-tick" }), f.reviewer._id);
  expect(next.reading.source).toBe("manual-override");
});

test("override audit records reject updates and preserve simulation-clock event times", async () => {
  const created = await request(app).post("/api/simulator/overrides").set(adminAuth).send(makeOverride(f.shipmentId));
  expect(created.status).toBe(201);
  const [audit] = await SimulatorOverrideAudit.find({ overrideId: created.body.override.overrideId }).lean();
  expect(audit.eventTime.toISOString()).toBe(f.at(0));
  await expect(SimulatorOverrideAudit.updateOne({ _id: audit._id }, { $set: { reason: "tampered" } })).rejects.toThrow("Append-only");
});
