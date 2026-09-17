const DEFAULT_START_TIME = "2026-01-01T00:00:00.000Z";
const DEFAULT_TICK_INTERVAL_MS = 5000;
const DEFAULT_ROUTE = [
  { latitude: 9.9312, longitude: 76.2673 },
  { latitude: 9.945, longitude: 76.282 },
  { latitude: 9.9588, longitude: 76.2971 },
];
const SCENARIOS = [
  "NORMAL",
  "HIGH_TEMPERATURE",
  "LOW_TEMPERATURE",
  "GPS_MOVEMENT",
  "BATTERY_DRAIN",
];

class SimulationNotFoundError extends Error {
  constructor(deviceId) {
    super(`Virtual device '${deviceId}' was not found`);
    this.name = "SimulationNotFoundError";
  }
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seedToInteger(seed) {
  const text = String(seed);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = seedToInteger(seed);

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normaliseRoute(route) {
  const selectedRoute = Array.isArray(route) && route.length >= 2 ? route : DEFAULT_ROUTE;

  return selectedRoute.map((point) => ({
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
  }));
}

function normaliseConfig(config = {}) {
  const startTime = new Date(config.startTime || DEFAULT_START_TIME);
  if (Number.isNaN(startTime.getTime())) {
    throw new Error("startTime must be a valid ISO-8601 date");
  }

  const scenario = String(config.scenario || "NORMAL").toUpperCase();
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`scenario must be one of: ${SCENARIOS.join(", ")}`);
  }

  const minTemperature = Number(config.temperatureRange?.min ?? 2);
  const maxTemperature = Number(config.temperatureRange?.max ?? 8);
  if (!Number.isFinite(minTemperature) || !Number.isFinite(maxTemperature) || minTemperature >= maxTemperature) {
    throw new Error("temperatureRange requires a finite min lower than max");
  }

  const tickIntervalMs = Number(config.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS);
  if (!Number.isInteger(tickIntervalMs) || tickIntervalMs < 10) {
    throw new Error("tickIntervalMs must be an integer of at least 10 milliseconds");
  }

  const initialBatteryLevel = Number(config.initialBatteryLevel ?? 100);
  if (!Number.isFinite(initialBatteryLevel) || initialBatteryLevel < 0 || initialBatteryLevel > 100) {
    throw new Error("initialBatteryLevel must be between 0 and 100");
  }

  if (!config.deviceId || !String(config.deviceId).trim()) {
    throw new Error("deviceId is required");
  }

  return {
    deviceId: String(config.deviceId).trim(),
    vehicleId: String(config.vehicleId || "").trim(),
    batchId: String(config.batchId || "").trim(),
    shipmentId: String(config.shipmentId || "").trim(),
    scenario,
    seed: String(config.seed ?? "1"),
    startTime: startTime.toISOString(),
    tickIntervalMs,
    route: normaliseRoute(config.route),
    temperatureRange: { min: minTemperature, max: maxTemperature },
    initialBatteryLevel,
  };
}

class VirtualDeviceSimulator {
  constructor(config) {
    this.config = normaliseConfig(config);
    this.reset();
  }

  reset() {
    this.random = createSeededRandom(this.config.seed);
    this.tickIndex = 0;
    this.currentTimeMs = new Date(this.config.startTime).getTime();
    this.batteryLevel = this.config.initialBatteryLevel;
    this.lastReading = null;
  }

  getLocation() {
    const { route } = this.config;
    const legs = route.length - 1;
    // Travel out and back without teleporting from the last point to the first.
    const cyclePosition = this.tickIndex % (legs * 20);
    const position = cyclePosition <= legs * 10 ? cyclePosition : legs * 20 - cyclePosition;
    const legIndex = Math.min(Math.floor(position / 10), legs - 1);
    const fraction = (position - legIndex * 10) / 10;
    const from = route[legIndex];
    const to = route[legIndex + 1] || route[0];

    return {
      latitude: round(from.latitude + (to.latitude - from.latitude) * fraction, 6),
      longitude: round(from.longitude + (to.longitude - from.longitude) * fraction, 6),
    };
  }

  getTemperature() {
    const { min, max } = this.config.temperatureRange;
    const variation = this.random();

    if (this.config.scenario === "HIGH_TEMPERATURE") {
      return round(max + 0.5 + variation * 3.5, 2);
    }

    if (this.config.scenario === "LOW_TEMPERATURE") {
      return round(min - 0.5 - variation * 3.5, 2);
    }

    return round(min + variation * (max - min), 2);
  }

  getDrainAmount() {
    const baseDrain = this.config.scenario === "BATTERY_DRAIN" ? 1.2 : 0.12;
    const variation = this.config.scenario === "BATTERY_DRAIN" ? 0.8 : 0.18;
    return baseDrain + this.random() * variation;
  }

  tick() {
    const timestamp = new Date(this.currentTimeMs).toISOString();
    const temperature = this.getTemperature();
    const humidity = round(45 + this.random() * 30, 2);
    const batteryLevel = round(this.batteryLevel, 2);
    const location = this.getLocation();

    const reading = {
      deviceId: this.config.deviceId,
      vehicleId: this.config.vehicleId,
      batchId: this.config.batchId,
      shipmentId: this.config.shipmentId,
      temperature,
      humidity,
      latitude: location.latitude,
      longitude: location.longitude,
      batteryLevel,
      timestamp,
      simulation: {
        source: "software-iot-simulator",
        scenario: this.config.scenario,
        seed: this.config.seed,
        tick: this.tickIndex,
      },
    };

    this.lastReading = reading;
    this.batteryLevel = Math.max(0, this.batteryLevel - this.getDrainAmount());
    this.tickIndex += 1;
    this.currentTimeMs += this.config.tickIntervalMs;

    return clone(reading);
  }

  getStatus(running = false) {
    return {
      ...clone(this.config),
      running,
      ticksGenerated: this.tickIndex,
      currentTime: new Date(this.currentTimeMs).toISOString(),
      nextTimestamp: new Date(this.currentTimeMs).toISOString(),
      batteryLevel: round(this.batteryLevel, 2),
      lastReading: this.lastReading ? clone(this.lastReading) : null,
    };
  }
}

class SimulatorManager {
  constructor() {
    this.simulators = new Map();
    this.intervals = new Map();
    this.busy = new Set();
    this.pending = new Map();
    this.errors = new Map();
  }

  createDevice(config) {
    const simulator = new VirtualDeviceSimulator(config);
    if (this.simulators.has(simulator.config.deviceId)) throw Object.assign(new Error("Device already exists; stop/reset it or use a new ID"), { status: 409 });
    this.stop(simulator.config.deviceId);
    this.simulators.set(simulator.config.deviceId, simulator);
    return simulator.getStatus(false);
  }

  getSimulator(deviceId) {
    const simulator = this.simulators.get(deviceId);
    if (!simulator) throw new SimulationNotFoundError(deviceId);
    return simulator;
  }

  async tickOnce(deviceId, persistReading) {
    const simulator = this.getSimulator(deviceId);
    if (this.busy.has(deviceId)) throw Object.assign(new Error("A tick is still being persisted"), { status: 409 });
    this.busy.add(deviceId);
    const reading = this.pending.get(deviceId) || simulator.tick();
    this.pending.set(deviceId, reading);
    try {
      const persistedReading = persistReading ? await persistReading(reading) : null;
      this.pending.delete(deviceId);
      this.errors.delete(deviceId);
      return { reading, persistedReading, simulation: this.getStatus(deviceId) };
    } catch (error) {
      this.errors.set(deviceId, error.message);
      this.stop(deviceId);
      throw error;
    } finally { this.busy.delete(deviceId); }
  }

  start(deviceId, persistReading) {
    const simulator = this.getSimulator(deviceId);
    if (this.intervals.has(deviceId)) return simulator.getStatus(true);

    const interval = setInterval(() => {
      if (this.busy.has(deviceId)) return;
      this.tickOnce(deviceId, persistReading).catch((error) => {
        // Stop on failure and retain the same reading for an explicit retry.
        console.error(`Simulator tick failed for ${deviceId}:`, error.message);
      });
    }, simulator.config.tickIntervalMs);

    // A running simulator should not prevent a clean shutdown in tests or local development.
    if (typeof interval.unref === "function") interval.unref();
    this.intervals.set(deviceId, interval);
    return simulator.getStatus(true);
  }

  stop(deviceId) {
    const interval = this.intervals.get(deviceId);
    if (interval) clearInterval(interval);
    this.intervals.delete(deviceId);

    const simulator = this.simulators.get(deviceId);
    return simulator ? simulator.getStatus(false) : null;
  }

  reset(deviceId) {
    const simulator = this.getSimulator(deviceId);
    if (this.busy.has(deviceId)) throw Object.assign(new Error("Wait for the current tick before resetting"), { status: 409 });
    this.stop(deviceId);
    this.pending.delete(deviceId);
    this.errors.delete(deviceId);
    simulator.reset();
    return simulator.getStatus(false);
  }

  setScenario(deviceId, scenario) {
    const simulator = this.getSimulator(deviceId);
    if (!SCENARIOS.includes(scenario)) throw Object.assign(new Error("Unknown scenario"), { status: 400 });
    if (this.busy.has(deviceId) || this.pending.has(deviceId)) throw Object.assign(new Error("Finish or retry the pending reading before changing scenario"), { status: 409 });
    this.stop(deviceId);
    simulator.config.scenario = scenario;
    return this.getStatus(deviceId);
  }

  getStatus(deviceId) {
    const simulator = this.getSimulator(deviceId);
    return { ...simulator.getStatus(this.intervals.has(deviceId)), lastError: this.errors.get(deviceId) || null, pendingRetry: this.pending.has(deviceId) };
  }

  getAllStatuses() {
    return Array.from(this.simulators.entries()).map(([deviceId, simulator]) =>
      this.getStatus(deviceId)
    );
  }

  clear() {
    Array.from(this.intervals.keys()).forEach((deviceId) => this.stop(deviceId));
    this.simulators.clear();
    this.pending.clear();
    this.errors.clear();
  }
}

module.exports = {
  DEFAULT_START_TIME,
  DEFAULT_TICK_INTERVAL_MS,
  SCENARIOS,
  SimulationNotFoundError,
  VirtualDeviceSimulator,
  SimulatorManager,
};
