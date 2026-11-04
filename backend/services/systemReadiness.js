const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const Audit = require("../models/ColdChainAudit");
const AuditAnchor = require("../models/AuditAnchor");
const TemperatureLog = require("../models/TemperatureLog");
const TelemetryAnchor = require("../models/TelemetryAnchor");
const blockchainService = require("./blockchainService");
const mqtt = require("mqtt");
const net = require("node:net");
const { createClient } = require("redis");
const emailTransport = require("./emailTransport");
const EmailDelivery = require("../models/EmailDelivery");
const { isAllowedLocalHost } = require("./localNetwork");

const DEFAULT_TIMEOUT_MS = 2500;
const EMAIL_HEALTH_TIMEOUT_MS = 10_000;
const EMAIL_HEALTH_CACHE_MS = 60_000;
let emailHealthCache = null;
async function hasRecentEmailCapture(now = Date.now()) {
  if (emailTransport.hasRecentEtherealCapture({ now })) return true;
  if (mongoose.connection.readyState !== 1) return false;
  return Boolean(await EmailDelivery.exists({ status: "sent", transportMode: "ethereal",
    providerPreviewUrl: { $type: "string", $ne: "" }, sentAt: { $gte: new Date(now - EMAIL_HEALTH_CACHE_MS) } }));
}
const AI_DECISION_TIMEOUT_MS = 2500;
const localHost = isAllowedLocalHost;

async function within(promise, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function elapsedSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

async function databaseHealth({ connection = mongoose.connection, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const result = {
    service: "MongoDB",
    check: "write-read-delete round trip",
    status: "unavailable",
    reachable: connection.readyState === 1,
    healthy: false,
    latencyMs: null,
    failure: null,
  };
  if (!result.reachable || !connection.db) {
    result.failure = "not-connected";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }

  const probeId = randomUUID();
  const probeValue = randomUUID();
  let failure = null;
  let passed = false;
  let insertAttempted = false;
  let collection;
  try {
    collection = connection.db.collection("system_readiness_probes");
    insertAttempted = true;
    await within(collection.insertOne({ _id: probeId, probeValue, createdAt: new Date() }), timeoutMs);
    const stored = await within(collection.findOne({ _id: probeId }, { maxTimeMS: timeoutMs }), timeoutMs);
    passed = stored?.probeValue === probeValue;
    if (!passed) failure = "read-back-mismatch";
  } catch (_) {
    failure = "read-write-probe-failed";
  } finally {
    if (collection && insertAttempted) {
      try {
        await within(collection.deleteOne({ _id: probeId }), timeoutMs);
      } catch (_) {
        passed = false;
        failure = "probe-cleanup-failed";
      }
    }
  }

  result.healthy = passed;
  result.status = passed ? "healthy" : "unhealthy";
  result.failure = failure;
  result.latencyMs = elapsedSince(startedAt);
  return result;
}

async function blockchainHealth({
  rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545",
  contractAddress = process.env.CONTRACT_ADDRESS || "",
  artifactPath = path.join(__dirname, "../../blockchain/artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json"),
  artifactExists = fs.existsSync,
  providerFactory = url => new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true, polling: false, cacheTimeout: -1 }),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  const addressConfigured = ethers.isAddress(contractAddress);
  const artifactAvailable = artifactExists(artifactPath);
  const result = {
    service: "local blockchain",
    check: "local block production and contract lookup",
    status: "unavailable",
    reachable: false,
    healthy: false,
    latencyMs: null,
    blockProgressed: false,
    contract: { addressConfigured, artifactAvailable, deployed: false, bytecodePresent: false, bytecodeBytes: 0,
      healthy: false, status: addressConfigured ? "not-checked" : "not-configured" },
    failure: null,
  };

  let rpc;
  try {
    rpc = new URL(rpcUrl);
  } catch (_) {
    result.status = "invalid-local-configuration";
    result.failure = "invalid-rpc-url";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }
  if (rpc.protocol !== "http:" || !localHost(rpc.hostname) || rpc.username || rpc.password) {
    result.status = "blocked-non-local-endpoint";
    result.failure = "local-rpc-required";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }

  let provider;
  try {
    provider = providerFactory(rpc.href);
    const network = await within(provider.getNetwork(), timeoutMs);
    result.reachable = true;
    result.chainId = Number(network.chainId);
    if (result.chainId !== 31337) {
      result.status = "wrong-chain";
      result.contract.status = addressConfigured ? "wrong-chain" : "not-configured";
      result.failure = "expected-local-hardhat-chain-31337";
      return result;
    }

    result.blockNumberBefore = await within(provider.getBlockNumber(), timeoutMs);
    // Hardhat mines on demand rather than advancing an idle chain. This empty block
    // probe verifies local mining without sending a contract transaction or changing
    // application state.
    await within(provider.send("evm_mine", []), timeoutMs);
    result.blockNumber = await within(provider.getBlockNumber(), timeoutMs);
    result.blockProgressed = result.blockNumber > result.blockNumberBefore;
    result.healthy = result.blockProgressed;
    result.status = result.healthy ? "healthy" : "not-progressing";
    if (!result.blockProgressed) result.failure = "block-number-did-not-advance";

    if (!addressConfigured) {
      result.healthy = false;
      result.status = "contract-not-ready";
      result.failure = "contract-address-required";
      result.contract.status = "not-configured";
      return result;
    }
    const code = await within(provider.getCode(contractAddress), timeoutMs);
    result.contract.bytecodePresent = typeof code === "string" && code !== "0x";
    result.contract.bytecodeBytes = result.contract.bytecodePresent ? Math.max(0, (code.length - 2) / 2) : 0;
    result.contract.deployed = result.contract.bytecodePresent;
    result.contract.healthy = artifactAvailable && result.contract.deployed;
    result.contract.status = !artifactAvailable ? "abi-artifact-missing" : result.contract.deployed ? "ready" : "no-contract-at-configured-address";
    if (!result.contract.healthy) {
      result.healthy = false;
      result.status = "contract-not-ready";
      result.failure = result.contract.status;
    }
  } catch (error) {
    if (result.contract.addressConfigured && result.blockProgressed) {
      result.contract.status = "unavailable";
      result.healthy = false;
      result.status = "contract-not-ready";
      result.failure = "contract-lookup-failed";
    } else {
      result.status = result.reachable ? "unhealthy" : "unreachable";
      result.healthy = false;
      result.failure = error.message === "timeout" ? "check-timeout" : "rpc-check-failed";
      if (result.contract.addressConfigured) result.contract.status = result.reachable ? "unavailable" : "unreachable";
    }
  } finally {
    try { provider?.destroy?.(); } catch (_) { /* cleanup must not mask the health result */ }
    result.latencyMs = elapsedSince(startedAt);
  }
  return result;
}

async function aiServiceHealth({
  baseUrl = process.env.AI_BASE_URL || "http://127.0.0.1:8000",
  post = axios.post,
  timeoutMs = AI_DECISION_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  const result = {
    service: "FastAPI AI service",
    check: "synthetic advisory decision request",
    status: "unavailable",
    reachable: false,
    healthy: false,
    latencyMs: null,
    failure: null,
  };
  let base;
  try {
    base = new URL(baseUrl);
  } catch (_) {
    result.status = "invalid-local-configuration";
    result.failure = "invalid-ai-url";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }
  if (base.protocol !== "http:" || !localHost(base.hostname) || base.username || base.password) {
    result.status = "blocked-non-local-endpoint";
    result.failure = "local-ai-service-required";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }

  const basePath = base.pathname.replace(/\/+$/, "");
  const url = `${base.origin}${basePath}/decision/decide`;
  const syntheticRequest = {
    social_text: "Synthetic local readiness check; no user or live-feed data.",
    vaccination_history: [1, 2, 3, 4, 5, 6],
    historical_data: [1, 2, 3, 4, 5, 6],
    current_stock: 100,
    target_center: "READINESS-CHECK",
  };
  try {
    const response = await within(post(url, syntheticRequest, { timeout: timeoutMs }), timeoutMs);
    result.reachable = true;
    const decision = response.data?.decision;
    result.healthy = response.status >= 200 && response.status < 300 && response.data?.advisory_only === true &&
      Number.isFinite(decision?.forecast_demand) && Number.isFinite(decision?.recommended_units) && typeof decision?.risk_flag === "boolean";
    result.status = result.healthy ? "healthy" : "invalid-response";
    if (!result.healthy) result.failure = "decision-response-invalid";
  } catch (error) {
    if (error.response) {
      result.reachable = true;
      result.status = "unhealthy";
      result.failure = "ai-service-error-response";
    } else {
      result.status = error.message === "timeout" || error.code === "ECONNABORTED" ? "timeout" : "unreachable";
      result.failure = error.message === "timeout" || error.code === "ECONNABORTED" ? "check-timeout" : "ai-request-failed";
    }
  }
  result.latencyMs = elapsedSince(startedAt);
  return result;
}

function redisRespCommand(command, args = []) {
  const parts = [command, ...args];
  return `*${parts.length}\r\n${parts.map(part => {
    const value = String(part);
    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }).join("")}`;
}

function pingRedis({ host, port, password, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = "";
    let expected = password ? 2 : 1;
    const responses = [];
    const finish = (error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve(responses.at(-1) === "+PONG");
    };
    socket.setTimeout(timeoutMs, () => finish(new Error("timeout")));
    socket.once("error", () => finish(new Error("redis-connection-failed")));
    socket.once("connect", () => {
      const auth = password ? redisRespCommand("AUTH", [password]) : "";
      socket.write(`${auth}${redisRespCommand("PING")}`);
    });
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      let end;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        responses.push(line);
        if (line.startsWith("-")) return finish(new Error("redis-command-rejected"));
        if (responses.length >= expected) return finish();
      }
    });
  });
}

async function redisHealth({ host = process.env.REDIS_HOST || "127.0.0.1", port = Number(process.env.REDIS_PORT || 6379),
  password = process.env.REDIS_PASSWORD || "", probe = pingRedis, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const result = { service: "Redis", check: "authenticated PING/PONG", status: "unavailable", reachable: false,
    healthy: false, latencyMs: null, failure: null };
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !isAllowedLocalHost(host)) {
    result.status = "invalid-local-configuration"; result.failure = "invalid-redis-endpoint";
    result.latencyMs = elapsedSince(startedAt); return result;
  }
  try {
    result.healthy = await within(probe({ host, port, password, timeoutMs }), timeoutMs);
    result.reachable = true;
    result.status = result.healthy ? "healthy" : "unhealthy";
    if (!result.healthy) result.failure = "unexpected-ping-response";
  } catch (error) {
    result.status = error.message === "timeout" ? "timeout" : "unreachable";
    result.failure = error.message === "timeout" ? "check-timeout" : "redis-check-failed";
  }
  result.latencyMs = elapsedSince(startedAt);
  return result;
}

async function workerHealth({ mode = process.env.WORKER_MODE || "internal", host = process.env.REDIS_HOST || "127.0.0.1",
  port = Number(process.env.REDIS_PORT || 6379), password = process.env.REDIS_PASSWORD || "",
  timeoutMs = DEFAULT_TIMEOUT_MS, createRedisClient = createClient, now = Date.now() } = {}) {
  const startedAt = Date.now();
  const result = { service: "Redis Stream worker", check: "fresh external-worker heartbeat", mode,
    status: "unavailable", reachable: false, healthy: false, latencyMs: null, heartbeatAgeMs: null, failure: null };
  if (mode !== "external") {
    result.status = "internal"; result.reachable = true; result.healthy = true; result.latencyMs = elapsedSince(startedAt);
    return result;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !isAllowedLocalHost(host)) {
    result.status = "invalid-local-configuration"; result.failure = "invalid-redis-endpoint";
    result.latencyMs = elapsedSince(startedAt); return result;
  }
  let client;
  try {
    client = createRedisClient({ socket: { host, port, connectTimeout: timeoutMs, reconnectStrategy: false }, password: password || undefined });
    client.on("error", () => {});
    await within(client.connect(), timeoutMs);
    result.reachable = true;
    const key = `${process.env.EVENT_STREAM_PREFIX || "vaccine:synthetic"}:worker:heartbeat`;
    const value = await within(client.get(key), timeoutMs);
    const timestamp = Number(value);
    result.heartbeatAgeMs = Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
    result.healthy = result.heartbeatAgeMs !== null && result.heartbeatAgeMs <= 15000;
    result.status = result.healthy ? "healthy" : "stale-or-missing";
    if (!result.healthy) result.failure = value ? "stale-heartbeat" : "heartbeat-missing";
  } catch (error) {
    result.status = error.message === "timeout" ? "timeout" : "unreachable";
    result.failure = error.message === "timeout" ? "check-timeout" : "worker-heartbeat-check-failed";
  } finally {
    if (client?.isOpen) await client.quit().catch(() => {});
    result.latencyMs = elapsedSince(startedAt);
  }
  return result;
}

async function mqttHealth({ url = process.env.MQTT_URL || "mqtt://127.0.0.1:1883", username = process.env.MQTT_USERNAME,
  password = process.env.MQTT_PASSWORD, connect = mqtt.connect, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const result = { service: "Mosquitto MQTT", check: "authenticated broker connection", status: "unavailable", reachable: false,
    healthy: false, latencyMs: null, transport: null, failure: null };
  let target;
  try { target = new URL(url); } catch (_) {
    result.status = "invalid-local-configuration"; result.failure = "invalid-mqtt-url";
    result.latencyMs = elapsedSince(startedAt); return result;
  }
  if (!(["mqtt:", "mqtts:"].includes(target.protocol)) || !isAllowedLocalHost(target.hostname) || target.username || target.password) {
    result.status = "blocked-non-local-endpoint"; result.failure = "local-mqtt-required";
    result.latencyMs = elapsedSince(startedAt); return result;
  }
  let client;
  try {
    await within(new Promise((resolve, reject) => {
      client = connect(target.toString(), { username: username || undefined, password: password || undefined,
        connectTimeout: timeoutMs, reconnectPeriod: 0, clean: true });
      let settled = false;
      const done = (error) => { if (settled) return; settled = true; error ? reject(error) : resolve(); };
      client.once("connect", () => done());
      client.once("error", () => done(new Error("mqtt-connection-failed")));
    }), timeoutMs);
    result.reachable = true; result.healthy = true; result.status = "healthy"; result.transport = target.protocol.slice(0, -1);
  } catch (error) {
    result.status = error.message === "timeout" ? "timeout" : "unreachable";
    result.failure = error.message === "timeout" ? "check-timeout" : "mqtt-connection-failed";
  } finally {
    if (client) try { client.end(true); } catch (_) { /* readiness cleanup is best-effort */ }
    result.latencyMs = elapsedSince(startedAt);
  }
  return result;
}

async function emailHealth({ check = emailTransport.health, timeoutMs = EMAIL_HEALTH_TIMEOUT_MS,
  now = Date.now, hasRecentCapture = hasRecentEmailCapture,
  cache = check === emailTransport.health } = {}) {
  const checkedAt = now();
  if (cache && emailHealthCache && checkedAt - emailHealthCache.checkedAt < EMAIL_HEALTH_CACHE_MS) {
    return { ...emailHealthCache.result, cached: true, cacheAgeMs: checkedAt - emailHealthCache.checkedAt };
  }
  const startedAt = Date.now();
  try {
    const provider = await within(check(), timeoutMs);
    const result = { service: "Ethereal demo email", check: provider.check || "mail transport verification",
      status: provider.status, reachable: provider.reachable === true, healthy: provider.healthy === true,
      latencyMs: elapsedSince(startedAt), mode: provider.mode || null, simulated: provider.simulated === true,
      previewAvailable: provider.previewAvailable === true, failure: provider.failure || null };
    if (cache) emailHealthCache = { checkedAt, result };
    return result;
  } catch (error) {
    const timedOut = error.message === "timeout";
    let captureWorked = false;
    if (timedOut) { try { captureWorked = await hasRecentCapture(checkedAt); } catch (_) { captureWorked = false; } }
    const result = { service: "Ethereal demo email", check: captureWorked
        ? "SMTP verify timed out; recent Ethereal capture succeeded" : "mail transport verification",
      status: captureWorked ? "degraded" : "unavailable", reachable: captureWorked, healthy: false,
      latencyMs: elapsedSince(startedAt), mode: captureWorked ? "ethereal" : null, simulated: true,
      previewAvailable: captureWorked, failure: captureWorked ? "smtp-probe-timeout-capture-confirmed"
        : timedOut ? "check-timeout" : "email-check-failed" };
    if (cache) emailHealthCache = { checkedAt, result };
    return result;
  }
}

function resetEmailHealthCache() { emailHealthCache = null; }

async function coldChainAnchoringHealth({
  enabled = process.env.AUDIT_ANCHOR_ENABLED === "true",
  databaseHealthy = mongoose.connection.readyState === 1,
  blockchain = {},
  writerConfigured = false,
  writerAuthorized = false,
  models = { Audit, AuditAnchor, TemperatureLog, TelemetryAnchor },
} = {}) {
  const signerReady = writerConfigured === true;
  const signerAuthorized = writerAuthorized === true;
  let counts = null;
  if (databaseHealthy) {
    try {
      const [auditTotal, auditConfirmed, auditFailed, readingTotal, readingConfirmed, readingFailed, rawReadingConfirmed, rawReadingFailed] = await Promise.all([
        models.Audit.countDocuments({}),
        models.AuditAnchor.countDocuments({ status: "confirmed" }),
        models.AuditAnchor.countDocuments({ status: "failed" }),
        models.TemperatureLog.countDocuments({ batchId: { $type: "string", $ne: "" } }),
        models.TelemetryAnchor.countDocuments({ status: "confirmed" }),
        models.TelemetryAnchor.countDocuments({ status: "failed" }),
        models.TelemetryAnchor.countDocuments({ rawChainStatus: "confirmed" }),
        models.TelemetryAnchor.countDocuments({ rawChainStatus: "failed" }),
      ]);
      counts = {
        coldChainAudit: { total: auditTotal, confirmed: auditConfirmed, failed: auditFailed,
          pending: Math.max(0, auditTotal - auditConfirmed - auditFailed) },
        temperatureHistory: { total: readingTotal, confirmed: readingConfirmed, failed: readingFailed,
          pending: Math.max(0, readingTotal - readingConfirmed - readingFailed), rawOnChainConfirmed: rawReadingConfirmed,
          rawOnChainFailed: rawReadingFailed, rawOnChainPending: Math.max(0, readingTotal - rawReadingConfirmed - rawReadingFailed) },
      };
    } catch (_) { counts = null; }
  }

  let status = "ready";
  if (!enabled) status = "disabled";
  else if (!databaseHealthy || !counts) status = "database-unavailable";
  else if (!blockchain.healthy) status = "local-chain-not-ready";
  else if (!blockchain.contract?.healthy) status = "contract-not-ready";
  else if (!signerReady) status = "writer-not-configured";
  else if (!signerAuthorized) status = "writer-not-authorized";

  return {
    enabled,
    ready: status === "ready",
    status,
    writerConfigured: signerReady,
    writerAuthorized: signerAuthorized,
    evidence: { coldChainAuditDigests: true, temperatureReadingDigests: true, rawTelemetryOnChain: true },
    counts,
  };
}

exports.getSystemReadiness = async (_req, res) => {
  const startedAt = Date.now();
  const [database, blockchain, ai, mqttBroker, redis, email, worker] = await Promise.all([
    databaseHealth(),
    blockchainHealth(),
    aiServiceHealth(),
    mqttHealth(),
    redisHealth(),
    emailHealth(),
    workerHealth(),
  ]);
  let writerStatus = { configured: false, authorized: false };
  if (process.env.AUDIT_ANCHOR_ENABLED === "true" && blockchain.healthy && blockchain.contract?.healthy) {
    try { writerStatus = await within(blockchainService.auditAnchorWriterStatus(), DEFAULT_TIMEOUT_MS); }
    catch (_) {
      writerStatus = { configured: blockchainService.auditAnchorWriterConfigured(), authorized: false };
    }
  }
  const auditAnchoring = await coldChainAnchoringHealth({ databaseHealthy: database.healthy, blockchain,
    writerConfigured: writerStatus.configured === true, writerAuthorized: writerStatus.authorized === true });
  const merkleAnchoring = process.env.TELEMETRY_ANCHOR_MODE === "legacy" ? null
    : await blockchainService.merkleContractStatus();
  if (merkleAnchoring && database.healthy) {
    const Window = require("../models/MerkleWindow"), Leaf = require("../models/MerkleLeaf");
    try {
      merkleAnchoring.windowsConfirmed = await Window.countDocuments({ status: "confirmed" });
      merkleAnchoring.windowsWaiting = await Window.countDocuments({ status: { $ne: "confirmed" } });
      merkleAnchoring.readingsCollecting = await Leaf.countDocuments({ windowId: { $exists: false } });
    } catch (_) { merkleAnchoring.countsUnavailable = true; }
  }
  if (merkleAnchoring) merkleAnchoring.windowSeconds = require("./merkleAnchoring").windowSeconds();
  auditAnchoring.evidence.rawTelemetryOnChain = process.env.TELEMETRY_ANCHOR_MODE === "legacy";
  auditAnchoring.evidence.sensorMerkleRoots = process.env.TELEMETRY_ANCHOR_MODE !== "legacy";
  return res.json({
    checkedAt: new Date().toISOString(),
    dataMode: { mode: ["simulator", "manual", "mixed"].includes(process.env.DATA_MODE) ? process.env.DATA_MODE : "mixed",
      simulatorEnabled: process.env.DATA_MODE !== "manual", label: process.env.DATA_MODE === "manual" ? "manual mode" : "" },
    backend: { service: "backend API", status: "healthy", reachable: true, healthy: true, latencyMs: elapsedSince(startedAt) },
    database,
    blockchain,
    ai,
    mqtt: mqttBroker,
    redis,
    worker,
    email,
    auditAnchoring,
    merkleAnchoring,
  });
};

exports.databaseHealth = databaseHealth;
exports.blockchainHealth = blockchainHealth;
exports.blockchainStatus = blockchainHealth;
exports.aiServiceHealth = aiServiceHealth;
exports.mqttHealth = mqttHealth;
exports.redisHealth = redisHealth;
exports.workerHealth = workerHealth;
exports.emailHealth = emailHealth;
exports.EMAIL_HEALTH_TIMEOUT_MS = EMAIL_HEALTH_TIMEOUT_MS;
exports.EMAIL_HEALTH_CACHE_MS = EMAIL_HEALTH_CACHE_MS;
exports.resetEmailHealthCache = resetEmailHealthCache;
exports.pingRedis = pingRedis;
exports.coldChainAnchoringHealth = coldChainAnchoringHealth;
