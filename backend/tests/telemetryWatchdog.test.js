const { DurableSimulatorManager } = require("../services/durableSimulator");
const watchdog = require("../services/telemetryWatchdog");
const { persistSimulationReading } = require("../services/telemetryService");
const Device = require("../models/SimulatorDevice");
const Alert = require("../models/TemperatureAlert");
const Log = require("../models/TemperatureLog");
const State = require("../models/TelemetryState");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
let f, manager, id;
beforeAll(connect, 15000); afterAll(close);
beforeEach(async () => {
  await Device.deleteMany({}); f = await fixture(); id = `WATCH-${f.batchId}`;
  manager = new DurableSimulatorManager();
  await manager.createDevice({ deviceId: id, batchId: f.batchId, shipmentId: f.shipmentId, seed: "watch", tickIntervalMs: 60000 }, f.reviewer._id);
});
afterEach(() => { manager.clear(); watchdog.stop(); jest.restoreAllMocks(); });
test("monitoring is opt-in and does not confuse a historical simulation with wall time", async () => {
  await watchdog.checkOnce(new Date("2026-09-17"));
  expect(await Alert.countDocuments({ batchId: f.batchId })).toBe(0);
  expect(await State.countDocuments({ batchId: f.batchId })).toBe(0);
});
test("armed clock detects a missing first reading without fabricating telemetry", async () => {
  await manager.setMonitoring(id, true);
  const record = await Device.findOne({ deviceId: id }).lean();
  const after = new Date(+record.monitoring.anchorWallAt + 180000);
  await watchdog.checkOnce(after);
  const alert = await Alert.findOne({ batchId: f.batchId });
  expect(alert).toMatchObject({ violationType: "TELEMETRY_RELIABILITY", severity: "WARNING", requiresQualityReview: false });
  expect(alert.reason).toContain("First expected sensor reading missing");
  expect(await Log.countDocuments({ batchId: f.batchId })).toBe(0);
  await watchdog.checkOnce(after);
  expect(await Alert.countDocuments({ batchId: f.batchId })).toBe(1);
});
test("normal interval alignment is not falsely late; silence is detected and disarming stops checks", async () => {
  await manager.tickOnce(id, persistSimulationReading);
  await manager.setMonitoring(id, true);
  const record = await Device.findOne({ deviceId: id }).lean();
  await watchdog.checkOnce(new Date(+record.monitoring.anchorWallAt + 59000));
  expect(await Alert.countDocuments({ batchId: f.batchId, violationType: "TELEMETRY_RELIABILITY" })).toBe(0);
  await manager.tickOnce(id, persistSimulationReading);
  await watchdog.checkOnce(new Date(+record.monitoring.anchorWallAt + 119000));
  expect(await Alert.countDocuments({ batchId: f.batchId, violationType: "TELEMETRY_RELIABILITY" })).toBe(0);
  await watchdog.checkOnce(new Date(+record.monitoring.anchorWallAt + 180000));
  expect(await Alert.countDocuments({ batchId: f.batchId, violationType: "TELEMETRY_RELIABILITY" })).toBe(1);
  const before = (await State.findOne({ batchId: f.batchId })).checkedAt;
  await manager.setMonitoring(id, false);
  await watchdog.checkOnce(new Date(+record.monitoring.anchorWallAt + 600000));
  expect((await State.findOne({ batchId: f.batchId })).checkedAt).toEqual(before);
});
test("monitor health reports failures instead of claiming success", async () => {
  jest.spyOn(Device, "find").mockImplementation(() => ({ lean: () => Promise.reject(new Error("offline")) }));
  expect((await watchdog.checkOnce()).lastError).toContain("failed");
});
