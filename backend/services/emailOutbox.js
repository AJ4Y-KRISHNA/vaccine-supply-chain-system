const EmailDelivery = require("../models/EmailDelivery");
const Notification = require("../models/Notification");
const User = require("../models/user");
const transport = require("./emailTransport");
const logger = require("./structuredLogger");

const emailEnabled = () => process.env.ALERT_EMAIL_ENABLED === "true";
const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};
const maxAttempts = () => boundedInteger(process.env.ALERT_EMAIL_MAX_ATTEMPTS, 5, 1, 10);
const retryBaseMs = () => boundedInteger(process.env.ALERT_EMAIL_RETRY_BASE_MS, 30000, 1000, 3600000);
const normalise = value => String(value || "").trim().toLowerCase();

function matchesManufacturer(user, key) {
  const field = { manufacturer: "manufacturer", distributor: "distributor", healthcare: "hospital" }[user.role];
  const affiliations = [user[field], ...(user.organizationAliases || [])];
  return affiliations.some(value => normalise(value) === key);
}

async function enqueueForNotification(notification) {
  if (!emailEnabled() || !notification || !["admin", "manufacturer", "distributor", "healthcare"].includes(notification.recipientRole)) {
    return { queued: 0, disabled: !emailEnabled() };
  }
  const users = await User.find({ role: notification.recipientRole, disabled: { $ne: true }, email: { $type: "string", $ne: "" } })
    .select("email role manufacturer distributor hospital organizationAliases disabled").lean();
  const recipientKey = normalise(notification.recipientRefKey);
  const recipients = users.filter(user => user.email?.trim() &&
    (notification.recipientRole === "admin" || matchesManufacturer(user, recipientKey)));
  const metadata = notification.metadata || {};
  const baseUrl = String(process.env.ALERT_EMAIL_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  let queued = 0;
  for (const user of recipients) {
    const email = user.email.trim();
    const deduplicationKey = `${notification.deduplicationKey}:email:${String(user._id)}:${normalise(email)}`;
    const result = await EmailDelivery.updateOne({ deduplicationKey }, { $setOnInsert: {
      deduplicationKey,
      notificationId: notification._id,
      recipientUserId: user._id,
      recipientRole: notification.recipientRole,
      recipientEmail: email,
      alertId: notification.alertId,
      correlationId: notification.correlationId || metadata.correlationId,
      batchId: notification.auditBatchId,
      subject: notification.title || `Cold-chain alert for batch ${notification.auditBatchId || "unknown"}`,
      text: `${notification.title || "Cold-chain alert"}\n\n${notification.message || ""}\n\nOpen the relevant dashboard: ${baseUrl}${metadata.deepLink || "/admin"}\n\nSoftware demo notification. Do not use for clinical decisions.`,
      status: "queued",
      simulated: false,
      attempts: 0,
      maxAttempts: maxAttempts(),
      nextAttemptAt: new Date(),
    } }, { upsert: true });
    if (result.upsertedCount) queued++;
  }
  return { queued, recipients: recipients.length };
}

let processing = false;
async function claim(now) {
  const staleLock = new Date(now.getTime() - 5 * 60 * 1000);
  return EmailDelivery.findOneAndUpdate({
    $or: [
      { status: { $in: ["queued", "failed"] }, nextAttemptAt: { $lte: now }, $expr: { $lt: ["$attempts", "$maxAttempts"] } },
      { status: "sending", lockedAt: { $lte: staleLock }, $expr: { $lt: ["$attempts", "$maxAttempts"] } },
    ],
  }, { $set: { status: "sending", lockedAt: now, lastError: undefined,
    transportMode: String(process.env.ALERT_EMAIL_TRANSPORT || "sendgrid").trim().toLowerCase(), simulated: false }, $inc: { attempts: 1 } },
  { new: true, sort: { createdAt: 1 } });
}

async function closeExpiredFinalAttempts(now) {
  const staleLock = new Date(now.getTime() - 5 * 60 * 1000);
  await EmailDelivery.updateMany({ status: "sending", lockedAt: { $lte: staleLock },
    $expr: { $gte: ["$attempts", "$maxAttempts"] } }, {
    $set: { status: "failed", deadLetterPending: require("./eventBackbone").enabled(), lastError: "Delivery worker stopped during the final allowed attempt; automatic retries are exhausted." },
    $unset: { lockedAt: 1, nextAttemptAt: 1 },
  });
}

async function publishDeadLetters() {
  const backbone = require("./eventBackbone");
  if (!backbone.enabled()) return;
  const rows = await EmailDelivery.find({ deadLetterPending: true }).limit(50);
  for (const row of rows) {
    try {
      const redis = await backbone.connection();
      await redis.eval(`if redis.call('HGET',KEYS[2],ARGV[1]) then return 0 end
redis.call('XADD',KEYS[1],'*','deliveryId',ARGV[1],'correlationId',ARGV[2],'reason',ARGV[3]);
redis.call('HSET',KEYS[2],ARGV[1],'1'); return 1`, { keys: [`${backbone.prefix()}:dead-letter:email`, `${backbone.prefix()}:dead-letter:email:dedupe`],
        arguments: [String(row._id), row.correlationId || "", row.lastError || "Email retries exhausted"] });
      await EmailDelivery.updateOne({ _id: row._id }, { $set: { deadLetterPending: false, deadLetterAt: new Date() } });
    } catch (_) { /* Mongo retains the pending DLQ handoff if Redis is down. */ }
  }
}

async function processOnce(limit = 10, now = new Date()) {
  if (processing) return { busy: true, sent: 0, failed: 0 };
  if (!emailEnabled()) return { disabled: true, sent: 0, failed: 0 };
  processing = true;
  const result = { sent: 0, failed: 0 };
  try {
    await closeExpiredFinalAttempts(now);
    await publishDeadLetters();
    const boundedLimit = boundedInteger(limit, 10, 1, 100);
    for (let index = 0; index < boundedLimit; index++) {
      const delivery = await claim(now);
      if (!delivery) break;
      try {
        const receipt = await transport.send({ to: delivery.recipientEmail, subject: delivery.subject, text: delivery.text });
        delivery.status = "sent";
        delivery.sentAt = new Date();
        delivery.providerMessageId = receipt?.providerMessageId || undefined;
        delivery.providerPreviewUrl = receipt?.previewUrl || undefined;
        delivery.transportMode = receipt?.transportMode || String(process.env.ALERT_EMAIL_TRANSPORT || "sendgrid").toLowerCase();
        delivery.simulated = receipt?.simulated === true;
        delivery.lastError = undefined;
        delivery.lockedAt = undefined;
        delivery.nextAttemptAt = undefined;
        await delivery.save();
        if (receipt?.previewUrl && delivery.notificationId) {
          try {
            await Notification.updateOne({ _id: delivery.notificationId,
              "emailPreviewLinks.url": { $ne: receipt.previewUrl } }, { $push: { emailPreviewLinks: {
              url: receipt.previewUrl, transportMode: delivery.transportMode, capturedAt: delivery.sentAt,
            } } });
          } catch (_) {
            logger.warn("notification.email.preview_record_failed", { correlationId: delivery.correlationId,
              alertId: delivery.alertId, recipientRole: delivery.recipientRole });
          }
        }
        logger.info("notification.email.sent", { correlationId: delivery.correlationId, alertId: delivery.alertId,
          recipientRole: delivery.recipientRole, transportMode: delivery.transportMode });
        result.sent++;
      } catch (error) {
        delivery.status = "failed";
        delivery.lastError = String(error?.message || "Email delivery failed").slice(0, 300);
        delivery.lockedAt = undefined;
        if (delivery.attempts < delivery.maxAttempts) {
          delivery.nextAttemptAt = new Date(now.getTime() + Math.min(retryBaseMs() * (2 ** (delivery.attempts - 1)), 24 * 60 * 60 * 1000));
        } else {
          delivery.deadLetterPending = require("./eventBackbone").enabled();
          delivery.nextAttemptAt = undefined;
        }
        await delivery.save();
        await publishDeadLetters();
        logger.warn("notification.email.failed", { correlationId: delivery.correlationId, alertId: delivery.alertId,
          recipientRole: delivery.recipientRole, attempt: delivery.attempts });
        result.failed++;
      }
    }
    return result;
  } finally { processing = false; }
}

let timer;
function start() {
  if (timer || !emailEnabled()) return;
  timer = setInterval(() => processOnce().catch(error => console.error("Alert email outbox run failed:", error.message)), 5000);
  timer.unref?.();
}
function stop() { clearInterval(timer); timer = null; }

module.exports = { emailEnabled, enqueueForNotification, processOnce, start, stop };
