const EdgeGatewayState = require("../models/EdgeGatewayState");
const EdgeGatewayQueue = require("../models/EdgeGatewayQueue");

class MongoGatewayStore {
  async getState(deviceId) {
    const state = await EdgeGatewayState.findOne({ deviceId }).lean();
    const latest = await EdgeGatewayQueue.findOne({ deviceId }).sort({ sequenceNumber: -1 }).lean();
    if (latest && latest.sequenceNumber > Number(state?.lastSequenceNumber ?? -1)) {
      const telemetry = latest.telemetry;
      const timestamp = new Date(telemetry.timestamp || telemetry.recordedAt).getTime();
      const recovered = { deviceId, lastSequenceNumber: latest.sequenceNumber,
        ewma: telemetry.edge?.ewma ?? telemetry.temperature, temperature: telemetry.temperature,
        timestamp, latitude: telemetry.latitude ?? telemetry.location?.lat, longitude: telemetry.longitude ?? telemetry.location?.lng,
        flatlineSince: state?.temperature === telemetry.temperature ? state.flatlineSince ?? state.timestamp : timestamp,
        points: [...(state?.points || []).filter(p => p.timestamp < timestamp && timestamp - p.timestamp <= 1800000),
          { temperature: telemetry.temperature, timestamp }],
        temperatures: [telemetry.temperature], lastSentAt: Date.now() };
      await this.saveState(deviceId, recovered);
      return { ...(state || {}), ...recovered };
    }
    return state;
  }
  async saveState(deviceId, state) {
    const { _id, __v, deviceId: ignored, createdAt, updatedAt, ...values } = state;
    await EdgeGatewayState.updateOne({ deviceId }, { $set: values, $setOnInsert: { deviceId } }, { upsert: true });
  }
  async findBySourceSequence(deviceId, sourceSequenceNumber) {
    return EdgeGatewayQueue.findOne({ deviceId, sourceSequenceNumber }).sort({ sequenceNumber: 1 }).lean();
  }
  async enqueue(entry) {
    try {
      return await EdgeGatewayQueue.create(entry);
    } catch (error) {
      if (error.code !== 11000) throw error;
      const found = entry.sourceSequenceNumber === null ? null : await this.findBySourceSequence(entry.deviceId, entry.sourceSequenceNumber);
      if (found) return found;
      return EdgeGatewayQueue.findOne({ deviceId: entry.deviceId, sequenceNumber: entry.sequenceNumber }).lean();
    }
  }
  async getQueueEntry(id) { return EdgeGatewayQueue.findById(id).lean(); }
  async listPending(deviceId) { return EdgeGatewayQueue.find({ deviceId, status: "pending" }).sort({ sequenceNumber: 1 }).lean(); }
  async pendingDevices() { return EdgeGatewayQueue.distinct("deviceId", { status: "pending" }); }
  async pendingCount() { return EdgeGatewayQueue.countDocuments({ status: "pending" }); }
  async markForwarded(id, record) {
    await EdgeGatewayQueue.updateOne({ _id: id, status: "pending" }, { $set: { status: "forwarded", forwardedAt: new Date(),
      backendRecord: record } });
  }
}

module.exports = MongoGatewayStore;
