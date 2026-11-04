const { createHash, randomUUID } = require("node:crypto");

// Keep default simulated sensor timestamps inside the backend's real-time
// ingestion window; deterministic tests and demonstrations may still override it.
const DEFAULT_START_TIME = new Date().toISOString();
const DEFAULT_TICK_INTERVAL_MS = 5000;
const DEFAULT_ROUTE = [
  { latitude: 9.9312, longitude: 76.2673, waypoint: "Kochi" },
  { latitude: 9.951, longitude: 76.349, waypoint: "Tripunithura" },
  { latitude: 9.984, longitude: 76.587, waypoint: "Muvattupuzha" },
  { latitude: 10.111, longitude: 76.474, waypoint: "Perumbavoor" },
  { latitude: 10.026, longitude: 76.312, waypoint: "Healthcare Center" },
];
const SCENARIOS = [
  "NORMAL",
  "DOOR_OPEN",
  "COMPRESSOR_DRIFT",
  "SENSOR_FLATLINE",
  "GPS_JUMP",
  "LINK_LOSS",
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

function readingCorrelationId(runId, tickIndex) {
  const bytes = createHash("sha256").update(`${runId}:${tickIndex}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // deterministic name-based UUID version
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  random.getState = () => state;
  random.setState = value => { state = value >>> 0; };
  return random;
}

function normaliseRoute(route) {
  const selectedRoute = Array.isArray(route) && route.length >= 2 ? route : DEFAULT_ROUTE;

  return selectedRoute.map((point) => ({
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    ...(point.waypoint ? { waypoint: String(point.waypoint) } : {}),
  }));
}

function normaliseConfig(config = {}) {
  const startTime = new Date(config.startTime || DEFAULT_START_TIME);
  if (Number.isNaN(startTime.getTime())) {
    throw new Error("startTime must be a valid ISO-8601 date");
  }

  const scenario = String(config.scenario || process.env.SIMULATOR_SCENARIO || "NORMAL").toUpperCase();
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

  const noiseScale = Number(config.noiseScale ?? 1);
  const driftSlopeCPerMinute = Number(config.driftSlopeCPerMinute ?? 0.18);
  if (!Number.isFinite(noiseScale) || noiseScale <= 0 || noiseScale > 10) {
    throw new Error("noiseScale must be greater than 0 and no more than 10");
  }
  if (!Number.isFinite(driftSlopeCPerMinute) || driftSlopeCPerMinute <= 0 || driftSlopeCPerMinute > 10) {
    throw new Error("driftSlopeCPerMinute must be greater than 0 and no more than 10");
  }

  return {
    deviceId: String(config.deviceId).trim(),
    vehicleId: String(config.vehicleId || "").trim(),
    batchId: String(config.batchId || "").trim(),
    shipmentId: String(config.shipmentId || "").trim(),
    scenario,
    seed: String(config.seed ?? process.env.SIMULATOR_SEED ?? "1"),
    startTime: startTime.toISOString(),
    tickIntervalMs,
    noiseScale,
    driftSlopeCPerMinute,
    route: normaliseRoute(config.route),
    temperatureRange: { min: minTemperature, max: maxTemperature },
    initialBatteryLevel,
  };
}

class VirtualDeviceSimulator {
  constructor(config) {
    this.config = normaliseConfig(config);
    this.nextSequenceNumber = 0;
    this.reset();
  }

  reset() {
    // tickIndex resets for a new synthetic run; sequenceNumber remains unique per
    // device so Mongo's (deviceId, sequenceNumber) idempotency key stays safe.
    if (!Number.isSafeInteger(this.nextSequenceNumber) || this.nextSequenceNumber < 0) this.nextSequenceNumber = 0;
    this.correlationSeed = randomUUID();
    this.random = createSeededRandom(this.config.seed);
    this.tickIndex = 0;
    this.scenarioStartTick = 0;
    this.currentTimeMs = new Date(this.config.startTime).getTime();
    this.batteryLevel = this.config.initialBatteryLevel;
    this.lastReading = null;
  }

  snapshot() {
    return clone({ version: 2, config: this.config, correlationSeed: this.correlationSeed,
      randomState: this.random.getState(), tickIndex: this.tickIndex, nextSequenceNumber: this.nextSequenceNumber,
      currentTimeMs: this.currentTimeMs, batteryLevel: this.batteryLevel, lastReading: this.lastReading,
      scenarioStartTick: this.scenarioStartTick });
  }

  static restore(snapshot) {
    if (![1, 2].includes(snapshot.version) || !Number.isSafeInteger(snapshot.tickIndex) || snapshot.tickIndex < 0 ||
      !Number.isSafeInteger(snapshot.randomState) || snapshot.randomState < 0 || snapshot.randomState > 0xffffffff ||
      !Number.isFinite(snapshot.batteryLevel) || snapshot.batteryLevel < 0 || snapshot.batteryLevel > 100) throw new Error("Invalid saved simulator state");
    const nextSequenceNumber = snapshot.nextSequenceNumber ?? snapshot.tickIndex;
    if (!Number.isSafeInteger(nextSequenceNumber) || nextSequenceNumber < snapshot.tickIndex || nextSequenceNumber < 0) {
      throw new Error("Invalid saved simulator sequence state");
    }
    const device = new VirtualDeviceSimulator(snapshot.config);
    const expectedClock = +new Date(device.config.startTime) + snapshot.tickIndex * device.config.tickIntervalMs;
    if (snapshot.currentTimeMs !== expectedClock || !Number.isFinite(+new Date(expectedClock))) throw new Error("Saved simulator clock is inconsistent");
    device.random.setState(snapshot.randomState);
    Object.assign(device, { correlationSeed: typeof snapshot.correlationSeed === "string" && snapshot.correlationSeed.length <= 128
      ? snapshot.correlationSeed : randomUUID(), tickIndex: snapshot.tickIndex, nextSequenceNumber,
      scenarioStartTick: Number.isSafeInteger(snapshot.scenarioStartTick) ? snapshot.scenarioStartTick : 0,
      currentTimeMs: snapshot.currentTimeMs,
      batteryLevel: snapshot.batteryLevel, lastReading: snapshot.lastReading });
    return device;
  }

  getLocation() {
    const { route } = this.config;
    const legs = route.length - 1;
    // Travel out and back without teleporting from the last point to the first.
    // Twenty minutes per leg, independent of sampling cadence. Even the longest
    // seeded leg stays below 120 km/h; high-frequency sampling is not speeding.
    const cyclePosition = (this.tickIndex * this.config.tickIntervalMs / 120000) % (legs * 20);
    const position = cyclePosition <= legs * 10 ? cyclePosition : legs * 20 - cyclePosition;
    const legIndex = Math.min(Math.floor(position / 10), legs - 1);
    const fraction = (position - legIndex * 10) / 10;
    const from = route[legIndex];
    const to = route[legIndex + 1] || route[0];

    const location = {
      latitude: round(from.latitude + (to.latitude - from.latitude) * fraction, 6),
      longitude: round(from.longitude + (to.longitude - from.longitude) * fraction, 6),
    };
    const scenarioElapsedTicks = this.tickIndex - this.scenarioStartTick;
    if (this.config.scenario === "GPS_JUMP" && scenarioElapsedTicks > 0 && scenarioElapsedTicks % 8 === 0) {
      location.latitude = round(location.latitude + 0.8, 6);
      location.longitude = round(location.longitude - 0.8, 6);
    }
    return location;
  }

  setScenario(scenario) {
    const selected = String(scenario || "").toUpperCase();
    if (!SCENARIOS.includes(selected)) throw new Error(`scenario must be one of: ${SCENARIOS.join(", ")}`);
    this.config.scenario = selected;
    this.scenarioStartTick = this.tickIndex;
  }

  getTemperature() {
    const { min, max } = this.config.temperatureRange;
    const variation = this.random();
    const noiseScale = this.config.noiseScale;

    if (["HIGH_TEMPERATURE", "DOOR_OPEN"].includes(this.config.scenario)) {
      return round(max + 0.5 + variation * 3.5 * noiseScale, 2);
    }

    if (this.config.scenario === "COMPRESSOR_DRIFT") {
      const elapsedMinutes = Math.max(0, this.tickIndex - this.scenarioStartTick) * this.config.tickIntervalMs / 60000;
      return round(Math.min(max + 4, min + (elapsedMinutes * this.config.driftSlopeCPerMinute) + variation * 0.15 * noiseScale), 2);
    }

    if (this.config.scenario === "LOW_TEMPERATURE") {
      return round(min - 0.5 - variation * 3.5, 2);
    }

    if (this.config.scenario === "SENSOR_FLATLINE" && this.lastReading) return this.lastReading.temperature;
    const midpoint = (min + max) / 2;
    return round(midpoint + (variation - 0.5) * (max - min) * noiseScale, 2);
  }

  getDrainAmount() {
    const baseDrain = this.config.scenario === "BATTERY_DRAIN" ? 1.2 : 0.12;
    const variation = this.config.scenario === "BATTERY_DRAIN" ? 0.8 : 0.18;
    return baseDrain + this.random() * variation;
  }

  tick() {
    const timestamp = new Date(this.currentTimeMs).toISOString();
    const temperature = this.getTemperature();
    const humidity = this.config.scenario === "SENSOR_FLATLINE" && this.lastReading
      ? this.lastReading.humidity
      : round(Math.max(0, Math.min(100, 60 + (this.random() - 0.5) * 30 * this.config.noiseScale)), 2);
    const batteryLevel = round(this.batteryLevel, 2);
    const location = this.getLocation();

    const scenarioElapsedTicks = this.tickIndex - this.scenarioStartTick;
    const groundTruthActive = ["DOOR_OPEN", "COMPRESSOR_DRIFT", "SENSOR_FLATLINE"].includes(this.config.scenario) ||
      (this.config.scenario === "GPS_JUMP" && scenarioElapsedTicks >= 8 &&
        [0, 1].includes(scenarioElapsedTicks % 8)); // Injected outbound AND return discontinuities.
    const reading = {
      correlationId: readingCorrelationId(this.correlationSeed, this.tickIndex),
      deviceId: this.config.deviceId,
      sequenceNumber: this.nextSequenceNumber,
      vehicleId: this.config.vehicleId,
      batchId: this.config.batchId,
      shipmentId: this.config.shipmentId,
      temperature,
      humidity,
      latitude: location.latitude,
      longitude: location.longitude,
      batteryLevel,
      timestamp,
      groundTruth: {
        anomaly_active: groundTruthActive,
        anomaly_type: groundTruthActive ? this.config.scenario.toLowerCase() : null,
      },
      simulation: {
        source: "software-iot-simulator",
        scenario: this.config.scenario,
        seed: this.config.seed,
        tick: this.tickIndex,
        scenarioStartTick: this.scenarioStartTick,
        scenarioElapsedTicks,
        linkLoss: this.config.scenario === "LINK_LOSS",
      },
    };

    this.lastReading = reading;
    this.batteryLevel = Math.max(0, this.batteryLevel - this.getDrainAmount());
    this.tickIndex += 1;
    this.nextSequenceNumber += 1;
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

  async tickOnce(deviceId, persistReading, transformReading) {
    const simulator = this.getSimulator(deviceId);
    if (this.busy.has(deviceId)) throw Object.assign(new Error("A tick is still being persisted"), { status: 409 });
    this.busy.add(deviceId);
    let reading = this.pending.get(deviceId) || simulator.tick();
    this.pending.set(deviceId, reading);
    try {
      // Transform only newly generated or not-yet-tagged legacy pending readings.
      // Once tagged, a retry reuses exactly the same serialized sample.
      if (transformReading && !["auto-simulated", "manual-override"].includes(reading.source)) {
        reading = await transformReading(reading);
        this.pending.set(deviceId, reading);
      }
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
    simulator.setScenario(scenario);
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
