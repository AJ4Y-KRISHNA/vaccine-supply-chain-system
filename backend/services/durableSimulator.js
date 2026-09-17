const { SimulatorManager, VirtualDeviceSimulator } = require("./iotSimulator");
const Device = require("../models/SimulatorDevice");
const User = require("../models/user");
const Batch = require("../models/Batch");
const { ownsIdentity } = require("../middleware/identityScope");
const busy = () => Object.assign(new Error("A device operation is still being persisted"), { status: 409 });

class DurableSimulatorManager {
  constructor() { this.memory = new SimulatorManager(); this.metadata = new Map(); this.operations = new Set(); this.loaded = false; }
  async initialize() {
    if (this.loaded) return;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const records = await Device.find().lean();
      for (const record of records) {
        const device = VirtualDeviceSimulator.restore(record.snapshot);
        if (record.deviceId !== device.config.deviceId) throw new Error("Saved device identity mismatch");
        this.memory.simulators.set(record.deviceId, device);
        this.metadata.set(record.deviceId, { createdBy: record.createdBy, startedBy: record.startedBy, restored: true, monitoring: record.monitoring });
        if (record.pendingReading) this.memory.pending.set(record.deviceId, record.pendingReading);
        if (record.lastError || record.running) this.memory.errors.set(record.deviceId, record.lastError || "Restored stopped after restart; explicitly resume when ready.");
      }
      this.loaded = true;
    })();
    try { await this.initializing; } finally { this.initializing = null; }
  }
  async run(deviceId, work) {
    await this.initialize();
    if (this.operations.has(deviceId)) throw busy();
    this.operations.add(deviceId);
    try { return await work(); } finally { this.operations.delete(deviceId); }
  }
  record(deviceId) {
    return { deviceId, snapshot: this.memory.getSimulator(deviceId).snapshot(),
      pendingReading: this.memory.pending.get(deviceId) || null, lastError: this.memory.errors.get(deviceId) || null,
      running: this.memory.intervals.has(deviceId), createdBy: this.metadata.get(deviceId).createdBy,
      startedBy: this.metadata.get(deviceId).startedBy };
  }
  async save(deviceId) {
    const result = await Device.updateOne({ deviceId }, { $set: this.record(deviceId) });
    if (result.matchedCount !== 1) throw new Error("Durable device checkpoint is missing");
  }
  async authorizeRuntime(deviceId, actorId) {
    const user = await User.findById(actorId || this.metadata.get(deviceId).startedBy || this.metadata.get(deviceId).createdBy).lean();
    if (!user || user.disabled || !["admin", "manufacturer"].includes(user.role)) throw new Error("Simulator operator is no longer authorized");
    const config = this.memory.getSimulator(deviceId).config;
    if (config.batchId) {
      const batch = await Batch.findOne({ batchId: config.batchId }).lean();
      if (!batch || user.role !== "admin" && !ownsIdentity(user, batch.manufacturer)) throw new Error("Simulator batch ownership changed");
    }
  }
  async createDevice(config, actorId) {
    return this.run(config.deviceId, async () => {
      if (this.memory.simulators.size >= 100) throw Object.assign(new Error("Local prototype device limit reached (100)"), { status: 429 });
      this.memory.createDevice(config);
      this.metadata.set(config.deviceId, { createdBy: actorId, restored: false });
      try { await Device.create(this.record(config.deviceId)); }
      catch (error) { this.memory.simulators.delete(config.deviceId); this.metadata.delete(config.deviceId); if (error.code === 11000) error.status = 409; throw error; }
      return this.getStatus(config.deviceId);
    });
  }
  async tickOnce(deviceId, persistReading, actorId) {
    return this.run(deviceId, async () => {
      let reading;
      try {
        await this.authorizeRuntime(deviceId, actorId);
        const result = await this.memory.tickOnce(deviceId, async nextReading => {
          reading = nextReading;
          // Durable pending reading and post-tick RNG/clock are saved before ingestion.
          await this.save(deviceId);
          return persistReading(nextReading);
        });
        await this.save(deviceId);
        return { ...result, simulation: this.getStatus(deviceId) };
      } catch (error) {
        this.memory.stop(deviceId);
        if (reading) this.memory.pending.set(deviceId, reading);
        this.memory.errors.set(deviceId, error.message);
        try { await this.save(deviceId); } catch (_) { /* Preserve in-memory retry; last successful durable checkpoint remains valid. */ }
        throw error;
      }
    });
  }
  async start(deviceId, persistReading, actorId) {
    return this.run(deviceId, async () => {
      await this.authorizeRuntime(deviceId, actorId);
      const device = this.memory.getSimulator(deviceId);
      if (this.memory.intervals.has(deviceId)) return this.getStatus(deviceId);
      this.metadata.get(deviceId).startedBy = actorId;
      const timer = setInterval(() => {
        if (this.operations.has(deviceId)) return;
        this.tickOnce(deviceId, persistReading).catch(() => {}); // Error is visible in persisted status; failures stop scheduling.
      }, device.config.tickIntervalMs);
      timer.unref?.(); this.memory.intervals.set(deviceId, timer);
      try { await this.save(deviceId); } catch (error) { this.memory.stop(deviceId); throw error; }
      return this.getStatus(deviceId);
    });
  }
  async mutate(deviceId, action) {
    return this.run(deviceId, async () => {
      const before = this.record(deviceId);
      try { action(); await this.save(deviceId); return this.getStatus(deviceId); }
      catch (error) {
        this.memory.stop(deviceId);
        this.memory.simulators.set(deviceId, VirtualDeviceSimulator.restore(before.snapshot));
        if (before.pendingReading) this.memory.pending.set(deviceId, before.pendingReading); else this.memory.pending.delete(deviceId);
        this.memory.errors.set(deviceId, error.message); throw error;
      }
    });
  }
  stop(deviceId) { return this.mutate(deviceId, () => this.memory.stop(deviceId)); }
  reset(deviceId) { return this.mutate(deviceId, () => this.memory.reset(deviceId)); }
  setScenario(deviceId, scenario) { return this.mutate(deviceId, () => this.memory.setScenario(deviceId, scenario)); }
  async setMonitoring(deviceId, enabled, asOf) {
    return this.run(deviceId, async () => {
      const device = this.memory.getSimulator(deviceId);
      // start() schedules its first tick one interval later. Anchor to the last
      // tick position, not the next timestamp, so normal scheduling is not late.
      const minimumClock = +new Date(device.getStatus().nextTimestamp) - device.config.tickIntervalMs;
      const anchor = new Date(asOf || minimumClock);
      if (!Number.isFinite(+anchor) || +anchor < minimumClock) throw Object.assign(new Error("Monitoring clock must not precede the last tick position"), { status: 400 });
      const monitoring = { enabled, anchorWallAt: new Date(), anchorSimulationAt: anchor,
        expectedSince: device.lastReading ? new Date(device.lastReading.timestamp) : new Date(+anchor + device.config.tickIntervalMs) };
      await Device.updateOne({ deviceId }, { $set: { monitoring } });
      this.metadata.get(deviceId).monitoring = monitoring;
      return this.getStatus(deviceId);
    });
  }
  getStatus(deviceId) { return { ...this.memory.getStatus(deviceId), durable: true, restored: this.metadata.get(deviceId)?.restored || false,
    monitoring: this.metadata.get(deviceId)?.monitoring || { enabled: false } }; }
  getAllStatuses() { return [...this.memory.simulators.keys()].map(id => this.getStatus(id)); }
  clear() { this.memory.clear(); this.metadata.clear(); this.loaded = false; }
}
module.exports = { DurableSimulatorManager };
