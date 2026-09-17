const {
  VirtualDeviceSimulator,
  SimulatorManager,
} = require("../services/iotSimulator");

const baseConfig = {
  deviceId: "IOT-001",
  vehicleId: "TRUCK-01",
  batchId: "VAC-001",
  shipmentId: "SHIP-001",
  seed: "cold-chain-demo",
  startTime: "2026-09-17T10:30:00.000Z",
  tickIntervalMs: 1000,
  route: [
    { latitude: 9.9312, longitude: 76.2673 },
    { latitude: 9.9412, longitude: 76.2773 },
  ],
};

describe("VirtualDeviceSimulator", () => {
  test("a fixed seed and configuration produce identical readings", () => {
    const first = new VirtualDeviceSimulator(baseConfig);
    const second = new VirtualDeviceSimulator(baseConfig);

    expect([first.tick(), first.tick(), first.tick()]).toEqual([
      second.tick(),
      second.tick(),
      second.tick(),
    ]);
  });

  test("the deterministic clock advances by the configured interval", () => {
    const simulator = new VirtualDeviceSimulator(baseConfig);
    const first = simulator.tick();
    const second = simulator.tick();

    expect(first.timestamp).toBe("2026-09-17T10:30:00.000Z");
    expect(second.timestamp).toBe("2026-09-17T10:30:01.000Z");
    expect(simulator.getStatus().currentTime).toBe("2026-09-17T10:30:02.000Z");
  });

  test("normal readings stay within the configured temperature range", () => {
    const simulator = new VirtualDeviceSimulator({
      ...baseConfig,
      scenario: "NORMAL",
      temperatureRange: { min: 2, max: 8 },
    });

    Array.from({ length: 10 }, () => simulator.tick()).forEach((reading) => {
      expect(reading.temperature).toBeGreaterThanOrEqual(2);
      expect(reading.temperature).toBeLessThanOrEqual(8);
      expect(reading.humidity).toBeGreaterThanOrEqual(45);
      expect(reading.humidity).toBeLessThanOrEqual(75);
    });
  });

  test("high and low temperature scenarios generate raw out-of-range readings", () => {
    const high = new VirtualDeviceSimulator({ ...baseConfig, scenario: "HIGH_TEMPERATURE" }).tick();
    const low = new VirtualDeviceSimulator({ ...baseConfig, scenario: "LOW_TEMPERATURE" }).tick();

    expect(high.temperature).toBeGreaterThan(8);
    expect(low.temperature).toBeLessThan(2);
  });

  test("GPS movement follows the configured route", () => {
    const simulator = new VirtualDeviceSimulator({ ...baseConfig, scenario: "GPS_MOVEMENT" });
    const first = simulator.tick();
    const second = simulator.tick();

    expect(first.latitude).toBe(9.9312);
    expect(first.longitude).toBe(76.2673);
    expect(second.latitude).toBeGreaterThan(first.latitude);
    expect(second.longitude).toBeGreaterThan(first.longitude);
  });

  test("GPS reaches the last waypoint and reverses smoothly", () => {
    const simulator = new VirtualDeviceSimulator(baseConfig);
    const readings = Array.from({ length: 12 }, () => simulator.tick());
    expect(readings[10].latitude).toBe(baseConfig.route[1].latitude);
    expect(readings[11].latitude).toBe(readings[9].latitude);
  });

  test("battery drain scenario decreases battery faster than a normal scenario", () => {
    const normal = new VirtualDeviceSimulator({ ...baseConfig, scenario: "NORMAL" });
    const drain = new VirtualDeviceSimulator({ ...baseConfig, scenario: "BATTERY_DRAIN" });

    normal.tick();
    drain.tick();
    const normalSecond = normal.tick();
    const drainSecond = drain.tick();

    expect(drainSecond.batteryLevel).toBeLessThan(normalSecond.batteryLevel);
    expect(drainSecond.batteryLevel).toBeLessThan(100);
  });
});

describe("SimulatorManager controls", () => {
  let manager;

  beforeEach(() => {
    manager = new SimulatorManager();
  });

  afterEach(() => {
    manager.clear();
  });

  test("creates, starts, stops, ticks, resets, and inspects a virtual device", async () => {
    const created = manager.createDevice(baseConfig);
    expect(created.running).toBe(false);
    expect(manager.getAllStatuses()).toHaveLength(1);

    const started = manager.start(baseConfig.deviceId, jest.fn());
    expect(started.running).toBe(true);

    const persistReading = jest.fn().mockResolvedValue({ _id: "telemetry-1" });
    const ticked = await manager.tickOnce(baseConfig.deviceId, persistReading);
    expect(persistReading).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "IOT-001" }));
    expect(ticked.persistedReading).toEqual({ _id: "telemetry-1" });
    expect(ticked.simulation.ticksGenerated).toBe(1);

    const stopped = manager.stop(baseConfig.deviceId);
    expect(stopped.running).toBe(false);

    const reset = manager.reset(baseConfig.deviceId);
    expect(reset.ticksGenerated).toBe(0);
    expect(reset.currentTime).toBe(baseConfig.startTime);
    expect(reset.lastReading).toBeNull();
  });

  test("persistence failure stops the timer and retries exactly the same deterministic reading", async () => {
    manager.createDevice(baseConfig);
    const persist = jest.fn().mockRejectedValueOnce(new Error("Database unavailable")).mockResolvedValueOnce({ _id: "log" });
    manager.start(baseConfig.deviceId, persist);
    await expect(manager.tickOnce(baseConfig.deviceId, persist)).rejects.toThrow("Database unavailable");
    expect(manager.getStatus(baseConfig.deviceId)).toMatchObject({ running: false, pendingRetry: true, ticksGenerated: 1 });
    await manager.tickOnce(baseConfig.deviceId, persist);
    expect(persist.mock.calls[0][0]).toEqual(persist.mock.calls[1][0]);
    expect(manager.getStatus(baseConfig.deviceId)).toMatchObject({ pendingRetry: false, ticksGenerated: 1 });
  });
  test("overlapping ticks and resets are rejected while a write is pending", async () => {
    manager.createDevice(baseConfig);
    let complete;
    const pending = manager.tickOnce(baseConfig.deviceId, () => new Promise(resolve => { complete = resolve; }));
    await expect(manager.tickOnce(baseConfig.deviceId)).rejects.toThrow("still being persisted");
    expect(() => manager.reset(baseConfig.deviceId)).toThrow("current tick");
    complete(); await pending;
    expect(manager.getStatus(baseConfig.deviceId).ticksGenerated).toBe(1);
  });
  test("scenario changes preserve seed position, identity and clock for recovery demonstrations", async () => {
    manager.createDevice({ ...baseConfig, scenario: "HIGH_TEMPERATURE" });
    const high = await manager.tickOnce(baseConfig.deviceId);
    manager.setScenario(baseConfig.deviceId, "NORMAL");
    const normal = await manager.tickOnce(baseConfig.deviceId);
    expect(high.reading.temperature).toBeGreaterThan(8);
    expect(normal.reading.temperature).toBeLessThanOrEqual(8);
    expect(normal.reading.simulation.tick).toBe(1);
    expect(+new Date(normal.reading.timestamp) - +new Date(high.reading.timestamp)).toBe(baseConfig.tickIntervalMs);
  });
});
