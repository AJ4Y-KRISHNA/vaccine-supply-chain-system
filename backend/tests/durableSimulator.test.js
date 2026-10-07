const { DurableSimulatorManager } = require("../services/durableSimulator");
const { VirtualDeviceSimulator } = require("../services/iotSimulator");
const Device = require("../models/SimulatorDevice");
const User = require("../models/user");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
let manager, f, config;
beforeAll(connect, 15000); afterAll(close);
beforeEach(async () => {
  await Device.deleteMany({});
  f = await fixture();
  config = { deviceId: f.batchId, batchId: f.batchId, shipmentId: f.shipmentId, seed: "durable-test", tickIntervalMs: 60000 };
  manager = new DurableSimulatorManager();
});
afterEach(() => { manager.clear(); jest.restoreAllMocks(); });
test("snapshot restores exact RNG, battery, scenario and clock without replay", () => {
  const a = new VirtualDeviceSimulator(config);
  for (let i = 0; i < 17; i++) a.tick();
  a.config.scenario = "BATTERY_DRAIN";
  const b = VirtualDeviceSimulator.restore(a.snapshot());
  expect(Array.from({ length: 10 }, () => a.tick())).toEqual(Array.from({ length: 10 }, () => b.tick()));
  expect(() => VirtualDeviceSimulator.restore({ ...a.snapshot(), currentTimeMs: 0 })).toThrow("clock");
});
test("device state survives restart, restores stopped, and continues deterministic readings", async () => {
  await manager.createDevice(config, f.reviewer._id);
  const persist = jest.fn().mockResolvedValue({ _id: "log" });
  await manager.tickOnce(config.deviceId, persist);
  await manager.start(config.deviceId, persist, f.reviewer._id);
  manager.clear();
  const restored = new DurableSimulatorManager(); await restored.initialize();
  try {
    expect(restored.getStatus(config.deviceId)).toMatchObject({ running: false, ticksGenerated: 1, restored: true, durable: true });
    const result = await restored.tickOnce(config.deviceId, persist);
    const reference = new VirtualDeviceSimulator(config); reference.tick();
    const expected = reference.tick();
    const { correlationId: _referenceCorrelationId, ...deterministicReading } = expected;
    const { correlationId: actualCorrelationId, ...actualReading } = result.reading;
    expect(actualCorrelationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(actualReading).toMatchObject({ ...deterministicReading, source: "auto-simulated", overrideId: null,
      simulation: { ...expected.simulation, telemetrySource: "auto-simulated", overrideId: null } });
  } finally { restored.clear(); }
});
test("pending failed reading survives restart and is retried without advancing again", async () => {
  await manager.createDevice(config, f.reviewer._id);
  const persist = jest.fn().mockRejectedValueOnce(new Error("Injected outage")).mockResolvedValue({ _id: "log" });
  await expect(manager.tickOnce(config.deviceId, persist)).rejects.toThrow("Injected outage");
  const attempted = persist.mock.calls[0][0]; manager.clear(); await manager.initialize();
  expect(manager.getStatus(config.deviceId)).toMatchObject({ pendingRetry: true, ticksGenerated: 1, running: false });
  expect((await manager.tickOnce(config.deviceId, persist)).reading).toEqual(attempted);
  expect(manager.getStatus(config.deviceId).ticksGenerated).toBe(1);
});
test("checkpoint failure prevents telemetry ingestion and keeps a retryable reading", async () => {
  await manager.createDevice(config, f.reviewer._id);
  jest.spyOn(manager, "save").mockRejectedValue(new Error("Checkpoint unavailable"));
  const persist = jest.fn();
  await expect(manager.tickOnce(config.deviceId, persist)).rejects.toThrow("Checkpoint unavailable");
  expect(persist).not.toHaveBeenCalled();
  expect(manager.getStatus(config.deviceId)).toMatchObject({ pendingRetry: true, running: false });
});
test("duplicate devices conflict; concurrent control changes reject while persistence is in flight", async () => {
  await manager.createDevice(config, f.reviewer._id);
  await expect(manager.createDevice(config, f.reviewer._id)).rejects.toMatchObject({ status: 409 });
  let release;
  const waiting = manager.tickOnce(config.deviceId, () => new Promise(resolve => { release = resolve; }));
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  await expect(manager.reset(config.deviceId)).rejects.toMatchObject({ status: 409 });
  release(); await waiting;
  await manager.reset(config.deviceId);
  manager.clear(); await manager.initialize();
  expect(manager.getStatus(config.deviceId).ticksGenerated).toBe(0);
});
test("disabled simulator operators cannot keep writing on timer/manual retries", async () => {
  await manager.createDevice(config, f.reviewer._id);
  await User.updateOne({ _id: f.reviewer._id }, { $set: { disabled: true } });
  const persist = jest.fn();
  await expect(manager.tickOnce(config.deviceId, persist)).rejects.toThrow("no longer authorized");
  expect(persist).not.toHaveBeenCalled();
});
