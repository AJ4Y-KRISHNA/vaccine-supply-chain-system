require("dotenv").config({ path: require("node:path").join(__dirname, ".env"), quiet: true });
require("./config/security").validateSecurity();

const mongoose = require("mongoose");
const logger = require("./services/structuredLogger");

let stopping = false;
let heartbeatTimer;
const heartbeatKey = `${process.env.EVENT_STREAM_PREFIX || "vaccine:synthetic"}:worker:heartbeat`;
async function heartbeat() {
  try {
    const redis = await require("./services/eventBackbone").connection();
    await redis.set(heartbeatKey, String(Date.now()), { EX: 15 });
  } catch (error) {
    logger.warn("worker.heartbeat_failed", { error: error.message });
  }
}
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeatTimer);
  require("./services/notificationDispatcher").stop();
  require("./services/emailOutbox").stop();
  require("./services/auditAnchoring").stop();
  await require("./services/eventBackbone").stop().catch(() => {});
  await mongoose.disconnect();
}

async function start() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required for the worker");
  await mongoose.connect(process.env.MONGO_URI);
  await require("./services/eventConsumers").start();
  require("./services/auditAnchoring").start();
  require("./services/emailOutbox").start();
  await heartbeat();
  heartbeatTimer = setInterval(heartbeat, 5000);
  heartbeatTimer.unref?.();
  logger.info("worker.started", { mode: "external" });
  process.once("SIGINT", () => stop().finally(() => process.exit(0)));
  process.once("SIGTERM", () => stop().finally(() => process.exit(0)));
}

start().catch(error => {
  logger.error("worker.start_failed", { error: error.message });
  process.exitCode = 1;
});
