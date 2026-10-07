// Phase 3 proof uses a unique Mongo DB/Redis prefix and disposable AI/chain.
// It never stops, resets or modifies the user's running chain or AI container.
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const root = path.resolve(__dirname, "../..");
require("dotenv").config({ path: path.join(root, ".env"), quiet: true });
const suffix = randomBytes(8).toString("hex"), dbName = `codex_cc_test_${suffix}`;
const aiName = `vaccine-phase3-test-${suffix}`;
const children = []; let server, provider, backbone, chainProcess, aiRunning = false;
async function freePort() {
  const s = net.createServer(); await new Promise(r => s.listen(0, "127.0.0.1", r));
  const port = s.address().port; await new Promise(r => s.close(r)); return port;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(work, description, timeout = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await work()) return; } catch (_) { /* startup/retry expected */ }
    await wait(200);
  }
  throw new Error(`Timed out: ${description}`);
}
function startChain(port) {
  const child = spawn(process.execPath, ["node_modules/hardhat/internal/cli/cli.js", "node", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: path.join(root, "blockchain"), windowsHide: true, stdio: "ignore" });
  children.push(child); chainProcess = child;
}
function startAI(port) {
  execFileSync("docker", ["run", "--rm", "-d", "--name", aiName, "-p", `127.0.0.1:${port}:8000`, "vaccine-supply-chain-demo-ai-service"], { stdio: "ignore", windowsHide: true });
  aiRunning = true;
}
async function main() {
  if (!process.argv.includes("--execute")) throw new Error("Use --execute for isolated synthetic outage tests");
  Object.assign(process.env, { NODE_ENV: "test", EVENT_BACKBONE_ENABLED: "true",
    EVENT_STREAM_PREFIX: `vaccine:test:${suffix}`, AUDIT_ANCHOR_ENABLED: "true",
    TELEMETRY_ANCHOR_MODE: "legacy", // Retained per-reading retry/outage compatibility proof.
    LOCAL_CHAIN_DEMO: "true", REDIS_HOST: "127.0.0.1", ALERT_EMAIL_ENABLED: "true",
    ALERT_EMAIL_TRANSPORT: "ethereal", JWT_SECRET: randomBytes(32).toString("hex"), REFRESH_SECRET: randomBytes(32).toString("hex"),
    TEMP_API_KEY: randomBytes(32).toString("hex") });
  const mongo = new URL(process.env.ACCEPTANCE_MONGO_URI || `mongodb://127.0.0.1:${process.env.MONGO_HOST_PORT || 27017}`);
  mongo.pathname = `/${dbName}`; mongo.searchParams.set("directConnection", "true");
  process.env.MONGO_URI = mongo.toString();
  const chainPort = await freePort(), aiPort = await freePort();
  process.env.RPC_URL = `http://127.0.0.1:${chainPort}`;
  process.env.AI_BASE_URL = `http://127.0.0.1:${aiPort}`;
  startChain(chainPort); startAI(aiPort);
  const rpcReady = async () => (await fetch(process.env.RPC_URL, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), signal: AbortSignal.timeout(1000) })).ok;
  const aiReady = async () => (await fetch(process.env.AI_BASE_URL, { signal: AbortSignal.timeout(1000) })).ok;
  await until(rpcReady, "isolated Hardhat startup"); await until(aiReady, "isolated AI startup");
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  async function deploy() {
    const wallet = i => ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
    const artifact = require("../../blockchain/artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json");
    const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet(0)).deploy(wallet(1).address, wallet(2).address);
    await contract.waitForDeployment(); process.env.CONTRACT_ADDRESS = await contract.getAddress();
  }
  await deploy();
  await mongoose.connect(process.env.MONGO_URI);
  const consumers = require("../services/eventConsumers"); backbone = require("../services/eventBackbone");
  await consumers.initialize();
  await Promise.all(Object.values(mongoose.models).map(m => m.init()));
  const { fixture } = require("../tests/helpers/coldChainFixture");
  const f = await fixture({ policy: { maximumReadingGapMs: 300000 } });
  const User = require("../models/user");
  for (const role of ["manufacturer", "distributor", "healthcare"]) await User.create({ role,
    email: `${role}@synthetic.example.test`, manufacturer: "maker-a", distributor: "dist-a", hospital: "hospital-a", isDemo: true });
  await User.updateOne({ _id: f.reviewer._id }, { $set: { isDemo: true } });
  // Atomicity: induce failure AFTER alert/audit/outbox writes and prove rollback.
  const sample = { batchId: f.batchId, shipmentId: f.shipmentId, deviceId: "rollback-device", vehicleId: "SYNTHETIC-TRUCK",
    temperature: 12, humidity: 60, batteryLevel: 90, timestamp: f.at(0) };
  await assert.rejects(mongoose.connection.transaction(async () => {
    await require("../services/temperatureAlertService").evaluateReading(sample);
    throw new Error("synthetic rollback proof");
  }), /rollback proof/);
  assert.equal(await require("../models/TemperatureAlert").countDocuments({ deviceId: sample.deviceId }), 0);
  assert.equal(await require("../models/ColdChainAudit").countDocuments(), 0);
  assert.equal(await require("../models/NotificationOutbox").countDocuments(), 0);
  const express = require("express"), app = express(); app.use(express.json());
  app.post("/ingest", require("../controllers/temperatureController").ingestLog);
  app.get("/logs", require("../controllers/temperatureController").getLogs);
  server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  async function send(seq, temp) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/ingest`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: "phase3-device", sequenceNumber: seq,
        batchId: f.batchId, shipmentId: f.shipmentId, vehicleId: "SYNTHETIC-TRUCK", temperature: temp,
        humidity: 60, batteryLevel: 90, location: { lat: 9.9312, lng: 76.2673 }, recordedAt: f.at(seq), correlationId: `phase3-${seq}` }),
      signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200); return (await response.json())[0];
  }
  // Stop dependencies before any telemetry chain writes, so restarting a fresh
  // disposable Hardhat node cannot invalidate existing application evidence.
  execFileSync("docker", ["stop", aiName], { stdio: "ignore", windowsHide: true }); aiRunning = false;
  chainProcess.kill(); await new Promise(r => chainProcess.once("exit", r));
  const first = await send(0, 12), duplicate = await send(0, 12);
  assert.equal(first.eventId, duplicate.eventId);
  const redis = await backbone.connection(); await backbone.ensureGroups(redis);
  assert.equal(await redis.xLen(backbone.stream()), 1);
  await backbone.start({ persistence: consumers.persistence, "policy-alert": consumers.policyAlert,
    "ai-advisory": consumers.aiAdvisory, anchoring: consumers.anchoring });
  require("../services/notificationDispatcher").start();
  const Log = require("../models/TemperatureLog"), Alert = require("../models/TemperatureAlert"), Receipt = require("../models/EventReceipt");
  await until(async () => (await Log.findById(first._id))?.evaluation?.anomalyInference?.status === "UNAVAILABLE", "AI unavailable state");
  await until(async () => await Alert.countDocuments({ deviceId: "phase3-device", metric: "TEMPERATURE" }) === 1, "alerts while AI/chain stopped");
  await send(1, 12); await send(2, 12); await send(3, 5);
  await until(async () => await Receipt.countDocuments({ group: "policy-alert" }) === 4, "policy catch-up without AI/chain");
  assert.equal(await Alert.countDocuments({ deviceId: "phase3-device", metric: "TEMPERATURE" }), 1);
  const alert = await Alert.findOne({ deviceId: "phase3-device", metric: "TEMPERATURE" });
  assert.ok(alert.excursionClosedAt); assert.equal(alert.requiresQualityReview, true);
  await until(async () => await require("../models/Notification").countDocuments({ alertId: alert.alertId }) >= 4, "all-role outbox fanout");
  assert.equal(await Receipt.countDocuments({ group: "ai-advisory" }), 0);
  assert.equal(await Receipt.countDocuments({ group: "anchoring" }), 0);
  console.log("PASS: stopped AI container and chain node did not block accepted telemetry, policy alerts or in-app notifications");
  // Restart stream workers while dependencies remain down; Redis pending entries
  // and retry metadata must survive and persistence must not duplicate records.
  await backbone.stop();
  await backbone.start({ persistence: consumers.persistence, "policy-alert": consumers.policyAlert,
    "ai-advisory": consumers.aiAdvisory, anchoring: consumers.anchoring });
  startChain(chainPort); startAI(aiPort);
  await until(rpcReady, "restarted chain"); await until(aiReady, "restarted AI container");
  await deploy();
  await require("../services/blockchainService").registerBatchOnChain(f.batchId, "SYNTHETIC TEST PRODUCT", 100);
  await until(async () => await Receipt.countDocuments({ group: "ai-advisory" }) === 4, "AI pending catch-up");
  await until(async () => await Receipt.countDocuments({ group: "anchoring" }) === 4, "chain pending catch-up", 120000);
  const latest = await Log.findById(first._id);
  assert.ok(Object.hasOwn(latest.evaluation.anomalyInference, "score"));
  assert.ok(latest.evaluation.anomalyInference.feature_contributions);
  const logsResponse = await fetch(`http://127.0.0.1:${server.address().port}/logs`);
  const dashboardLogs = await logsResponse.json();
  assert.equal(dashboardLogs.length, 4);
  assert.ok(dashboardLogs.every(row => row.eventId && row.evaluation?.policyStatus === "APPROVED"));
  assert.equal(await mongoose.connection.db.collection("telemetry_measurements").countDocuments(), 4);
  assert.equal(await require("../models/LocationHistory").countDocuments(), 4);
  assert.equal(await Log.countDocuments(), 4);
  // Replay completed work: no duplicate readings, alerts, measurements or evidence.
  await consumers.persistence(backbone.envelope({ ...first }));
  assert.equal(await Log.countDocuments(), 4);
  const collection = (await mongoose.connection.db.listCollections({ name: "telemetry_measurements" }).toArray())[0];
  assert.equal(collection.options.timeseries.timeField, "recordedAt");
  assert.equal(collection.options.expireAfterSeconds, 7776000);
  const emails = await require("../services/emailOutbox").processOnce(20);
  assert.ok(emails.sent >= 4, `Ethereal captures: ${JSON.stringify(emails)}`);
  const recipients = await require("../models/EmailDelivery").distinct("recipientRole", { status: "sent" });
  assert.deepEqual(recipients.sort(), ["admin", "distributor", "healthcare", "manufacturer"]);
  const restartedRedis = await backbone.connection();
  for (const group of backbone.groups) assert.equal((await restartedRedis.xPending(backbone.stream(), group)).pending, 0);
  console.log(JSON.stringify({ outcome: "PASS", synthetic: true, telemetry: 4,
    groupsCaughtUp: backbone.groups, alertsPerExcursion: 1, atomicRollback: true,
    timeSeriesRetentionDays: 90, emailCaptures: emails.sent, emailRoles: recipients }, null, 2));
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => {
  require("../services/notificationDispatcher").stop();
  if (backbone) await backbone.stop();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  if (mongoose.connection.name === dbName && /^codex_cc_test_[a-f0-9]{16}$/.test(dbName)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); provider?.destroy();
  if (backbone) {
    const redis = await backbone.connection();
    for await (const keys of redis.scanIterator({ MATCH: `${backbone.prefix()}:*`, COUNT: 100 })) await redis.del(keys);
    await backbone.stop();
  }
  if (aiRunning) try { execFileSync("docker", ["stop", aiName], { stdio: "ignore", windowsHide: true }); } catch (_) {}
  for (const child of children) if (child.exitCode === null) child.kill();
  console.log("Removed only isolated Phase 3 test data/services; existing demo services and data retained.");
});
