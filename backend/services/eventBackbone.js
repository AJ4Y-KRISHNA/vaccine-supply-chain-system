const { createClient } = require("redis");
const { createHash, randomUUID } = require("node:crypto");
const logger = require("./structuredLogger");
const enabled = () => process.env.EVENT_BACKBONE_ENABLED === "true";
const prefix = () => process.env.EVENT_STREAM_PREFIX || "vaccine:synthetic";
const stream = () => `${prefix()}:telemetry.accepted`;
const groups = ["persistence", "policy-alert", "ai-advisory", "anchoring"];
let client, connecting;
async function connection() {
  if (client?.isReady) return client;
  if (!connecting) {
    client = createClient({ socket: { host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT || 6379), connectTimeout: 2000,
      reconnectStrategy: false }, password: process.env.REDIS_PASSWORD || undefined });
    client.on("error", () => logger.warn("stream.redis.unavailable", {}));
    connecting = client.connect().then(() => client).finally(() => { connecting = null; });
  }
  return connecting;
}
function envelope(reading) {
  const { buildIdempotencyKey, normaliseSequenceNumber } = require("./telemetryService");
  const normalized = normaliseSequenceNumber(reading);
  const key = buildIdempotencyKey(normalized);
  const eventId = key ? createHash("sha256").update(key).digest("hex") : randomUUID();
  return { type: "telemetry.accepted", eventId, correlationId: normalized.correlationId,
    acceptedAt: new Date().toISOString(), synthetic: true,
    reading: { ...normalized, _id: createHash("sha256").update(eventId).digest("hex").slice(0, 24),
      eventId, isDemo: true, demoProvenance: "synthetic-event-backbone" } };
}
// The dedupe receipt and XADD are atomic. Retries return the ORIGINAL envelope,
// not a caller's changed timestamp, correlation ID, or batch context.
const publishLua = `local prior=redis.call('HGET',KEYS[2],ARGV[1]); if prior then return prior end
local id=redis.call('XADD',KEYS[1],'*','event',ARGV[2]);
redis.call('HSET',KEYS[2],ARGV[1],ARGV[2]); return ARGV[2]`;
async function publish(readings) {
  const redis = await connection();
  const receipts = [];
  for (const reading of readings) {
    const event = envelope(reading);
    const saved = JSON.parse(await redis.eval(publishLua, { keys: [stream(), `${prefix()}:accepted`],
      arguments: [event.eventId, JSON.stringify(event)] }));
    receipts.push({ ...saved.reading, eventId: saved.eventId, correlationId: saved.correlationId,
      accepted: true, processingStatus: "QUEUED" });
    logger.info("stream.telemetry.accepted", { eventId: saved.eventId, correlationId: saved.correlationId });
  }
  return receipts;
}
const backoff = attempt => Math.min(500 * 2 ** Math.max(0, attempt - 1), 30000);
async function ensureGroups(redis) {
  for (const group of groups) try { await redis.xGroupCreate(stream(), group, "0", { MKSTREAM: true }); }
  catch (error) { if (!error.message.includes("BUSYGROUP")) throw error; }
}
async function deadLetter(redis, group, message, event, error, attempt) {
  await redis.multi().xAdd(`${prefix()}:dead-letter:${group}`, "*", {
    event: JSON.stringify(event), sourceId: message.id, group, attempt: String(attempt),
    correlationId: event.correlationId || "", reason: String(error.message).slice(0, 300),
  }).xAck(stream(), group, message.id).hDel(`${prefix()}:retry:${group}`, message.id).exec();
}
async function consumeOnce(group, handler, redis = null, now = Date.now()) {
  redis ||= await connection();
  const consumer = `${group}-local-worker`; // One sequential worker per group in this local demo.
  // Recover a crashed worker's oldest pending event before reading new events.
  let messages = (await redis.xReadGroup(group, consumer, [{ key: stream(), id: "0" }], { COUNT: 1 }))?.[0]?.messages || [];
  if (!messages.length) {
    const claimed = await redis.xAutoClaim(stream(), group, consumer, 300000, "0-0", { COUNT: 1 });
    messages = claimed.messages || [];
  }
  if (!messages.length) messages = (await redis.xReadGroup(group, consumer, [{ key: stream(), id: ">" }], { COUNT: 1 }))?.[0]?.messages || [];
  if (!messages.length) return false;
  const message = messages[0];
  const retryKey = `${prefix()}:retry:${group}`;
  const retry = JSON.parse(await redis.hGet(retryKey, message.id) || "{}");
  if (retry.nextAt > now) return false;
  let event;
  try {
    event = JSON.parse(message.message.event);
    await handler(event);
    await redis.multi().xAck(stream(), group, message.id).hDel(retryKey, message.id).exec();
    logger.info("stream.consumer.completed", { group, eventId: event.eventId, correlationId: event.correlationId });
  } catch (error) {
    event ||= { malformedPayload: message.message.event, correlationId: "" };
    // Dependencies inside the pipeline are not failed external-service attempts.
    const attempt = error.dependencyPending ? (retry.attempt || 0) : (retry.attempt || 0) + 1;
    if (attempt >= Number(process.env.EVENT_MAX_ATTEMPTS || 20)) await deadLetter(redis, group, message, event, error, attempt);
    else await redis.hSet(retryKey, message.id, JSON.stringify({ attempt,
      nextAt: now + (error.dependencyPending ? 250 : backoff(attempt)) }));
    logger.warn("stream.consumer.retry", { group, eventId: event.eventId, correlationId: event.correlationId, attempt });
  }
  return true;
}
let stopped = true, loops = [];
async function start(handlers) {
  if (!stopped) return;
  const redis = await connection();
  await ensureGroups(redis);
  stopped = false;
  loops = groups.map(async group => {
    while (!stopped) {
      try { if (await consumeOnce(group, handlers[group])) continue; }
      catch (_) { logger.warn("stream.consumer.connection_retry", { group }); }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  });
}
async function stop() {
  stopped = true; await Promise.all(loops); loops = [];
  if (client?.isOpen) await client.quit(); client = null;
}
module.exports = { enabled, prefix, stream, groups, envelope, publish, connection,
  ensureGroups, consumeOnce, backoff, deadLetter, start, stop };
