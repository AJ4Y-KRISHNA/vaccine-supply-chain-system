const Outbox = require("../models/NotificationOutbox");
const Alert = require("../models/TemperatureAlert");
const backbone = require("./eventBackbone");
let busy = false, timer;
async function enqueue(alert, stage) {
  await Outbox.updateOne({ deduplicationKey: `${alert.alertId}:${stage}` }, { $setOnInsert: {
    alertId: alert.alertId, correlationId: alert.correlationId, stage, snapshot: alert.toObject(),
  } }, { upsert: true });
}
async function processOnce() {
  if (busy) return; busy = true;
  try {
    const row = await Outbox.findOneAndUpdate({ $or: [
      { status: "queued", nextAttemptAt: { $lte: new Date() } },
      { status: "sending", lockedAt: { $lt: new Date(Date.now() - 300000) } },
    ] }, { $set: { status: "sending", lockedAt: new Date() }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
    if (!row) return;
    try {
      // Use the committed transition snapshot, not a later recovery reading.
      const snapshot = Alert.hydrate(row.snapshot);
      await require("./coldChainActions").notify(snapshot, row.stage, { dispatch: true });
      row.status = "sent"; row.lastError = undefined;
      require("./structuredLogger").info("notification.outbox.dispatched", { correlationId: row.correlationId, alertId: row.alertId });
    } catch (error) {
      row.lastError = String(error.message).slice(0, 300);
      require("./structuredLogger").warn("notification.outbox.retry", { correlationId: row.correlationId, alertId: row.alertId, attempt: row.attempts });
      if (row.attempts >= Number(process.env.EVENT_MAX_ATTEMPTS || 20)) {
        await (await backbone.connection()).xAdd(`${backbone.prefix()}:dead-letter:outbox`, "*", {
          outboxId: String(row._id), correlationId: row.correlationId || "", reason: row.lastError,
        });
        row.status = "dead-letter";
      } else { row.status = "queued"; row.nextAttemptAt = new Date(Date.now() + backbone.backoff(row.attempts)); }
    }
    row.lockedAt = undefined; await row.save();
  } finally { busy = false; }
}
function start() { if (!timer) { timer = setInterval(() => processOnce().catch(() => {}), 250); timer.unref?.(); } }
function stop() { clearInterval(timer); timer = null; }
module.exports = { enqueue, processOnce, start, stop };
