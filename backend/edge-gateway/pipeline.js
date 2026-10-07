const { createHash } = require("node:crypto");
const { evaluateEdgeReading } = require("./edgeMath");

function fingerprint(reading) {
  const stable = { temperature: reading.temperature, humidity: reading.humidity, batteryLevel: reading.batteryLevel,
    latitude: reading.latitude ?? reading.location?.lat, longitude: reading.longitude ?? reading.location?.lng,
    vehicleId: reading.vehicleId, batchId: reading.batchId };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

class EdgeGatewayPipeline {
  constructor({ store, forward, now = () => Date.now(), heartbeatMs = 30000, edgeOptions = {} }) {
    if (!store || typeof forward !== "function") throw new TypeError("Edge gateway store and upstream forwarder are required");
    this.store = store;
    this.forward = forward;
    this.now = now;
    this.heartbeatMs = heartbeatMs;
    this.edgeOptions = edgeOptions;
    this.locks = new Map();
    this.flushLocks = new Map();
  }

  async receive(reading, { transport = "http" } = {}) {
    const deviceId = String(reading.deviceId || reading.sensorId || "").trim();
    if (!deviceId) throw new Error("deviceId is required for edge processing");
    const prior = this.locks.get(deviceId) || Promise.resolve();
    let release;
    const lock = new Promise(resolve => { release = resolve; });
    const queuedLock = prior.then(() => lock);
    this.locks.set(deviceId, queuedLock);
    await prior;
    try {
      const state = await this.store.getState(deviceId) || {};
      const simulatedLinkLoss = String(reading.simulation?.scenario || "").toUpperCase() === "LINK_LOSS";
      state.linkLoss = simulatedLinkLoss;
      await this.store.saveState(deviceId, state);
      const sourceSequenceNumber = Number.isSafeInteger(reading.sequenceNumber) ? reading.sequenceNumber :
        Number.isSafeInteger(reading.simulation?.tick) ? reading.simulation.tick : null;
      if (sourceSequenceNumber !== null) {
        const duplicate = await this.store.findBySourceSequence(deviceId, sourceSequenceNumber);
        if (duplicate) {
          if (duplicate.status === "pending" && String(reading.simulation?.scenario || "").toUpperCase() !== "LINK_LOSS") await this.flushDevice(deviceId);
          return { ...(duplicate.backendRecord || duplicate.telemetry), delivery: duplicate.status === "forwarded" ? "forwarded" : "buffered", duplicate: true };
        }
      }

      const currentFingerprint = fingerprint(reading);
      const now = this.now();
      const changed = state.lastFingerprint !== currentFingerprint;
      const heartbeatDue = state.lastSentAt === undefined || now - state.lastSentAt >= this.heartbeatMs;
      const { edge, state: nextEdgeState } = evaluateEdgeReading(reading, state, this.edgeOptions);
      if (!changed && !heartbeatDue) {
        // Advance physical/timed context for EVERY raw fix, even when transport
        // suppresses a redundant sample. A later movement is measured from the
        // last fix, not averaged over a long stationary heartbeat interval.
        await this.store.saveState(deviceId, { ...state, ...nextEdgeState });
        if (!simulatedLinkLoss) await this.flushDevice(deviceId);
        return { deviceId, delivery: "suppressed", suppressed: true };
      }

      const sequenceNumber = Math.max(0, Number(state.lastSequenceNumber ?? -1) + 1);
      const telemetry = { ...reading, deviceId, sequenceNumber, edge,
        simulation: { ...(reading.simulation || {}), sourceSequenceNumber,
          source: reading.simulation?.source || "synthetic-edge-gateway" } };
      const entry = await this.store.enqueue({ deviceId, sequenceNumber, sourceSequenceNumber,
        correlationId: reading.correlationId, telemetry });
      await this.store.saveState(deviceId, { ...nextEdgeState, lastSequenceNumber: sequenceNumber,
        lastFingerprint: currentFingerprint, lastSentAt: now, linkLoss: simulatedLinkLoss });
      const forwarded = simulatedLinkLoss ? false : await this.flushDevice(deviceId);
      const current = await this.store.getQueueEntry(entry._id || entry.id);
      return { ...(current?.backendRecord || current?.telemetry || telemetry), delivery: forwarded ? "forwarded" : "buffered", duplicate: false };
    } finally {
      release();
      if (this.locks.get(deviceId) === queuedLock) this.locks.delete(deviceId);
    }
  }

  async flushDevice(deviceId) {
    const prior = this.flushLocks.get(deviceId) || Promise.resolve();
    let release;
    const lock = new Promise(resolve => { release = resolve; });
    const queuedLock = prior.then(() => lock);
    this.flushLocks.set(deviceId, queuedLock);
    await prior;
    try { return await this._flushDevice(deviceId); }
    finally {
      release();
      if (this.flushLocks.get(deviceId) === queuedLock) this.flushLocks.delete(deviceId);
    }
  }

  async _flushDevice(deviceId) {
    if ((await this.store.getState(deviceId))?.linkLoss) return false;
    const pending = await this.store.listPending(deviceId);
    for (const entry of pending) {
      try {
        const [record] = await this.forward([entry.telemetry], { correlationId: entry.correlationId, transport: "edge-buffer" });
        if (!record || typeof record !== "object") return false;
        await this.store.markForwarded(entry._id || entry.id, record);
      } catch (_) {
        return false; // Preserve order: never skip a failed sequence.
      }
    }
    return true;
  }

  async flushAll() {
    const deviceIds = await this.store.pendingDevices();
    const results = [];
    for (const deviceId of deviceIds) results.push({ deviceId, flushed: await this.flushDevice(deviceId) });
    return results;
  }
}

module.exports = { EdgeGatewayPipeline, fingerprint };
