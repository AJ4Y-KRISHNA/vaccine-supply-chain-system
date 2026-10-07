const assert = require("node:assert/strict"), path = require("node:path"), net = require("node:net");
const { spawn } = require("node:child_process"), { randomBytes } = require("node:crypto");
const fs = require("node:fs/promises"), mongoose = require("mongoose"), { ethers } = require("ethers");
const root = path.resolve(__dirname, "../.."), dbName = "codex_cc_test_" + randomBytes(8).toString("hex");
let child, server, previewServer, provider;
const streams = process.argv.includes("--streams"), streamPrefix = "vaccine:phase5:test:" + randomBytes(8).toString("hex");
async function main() {
  if (!process.argv.includes("--execute")) throw new Error("Use --execute for an isolated synthetic database and chain");
  Object.assign(process.env, { NODE_ENV: "test", EVENT_BACKBONE_ENABLED: "false", AUDIT_ANCHOR_ENABLED: "false", TELEMETRY_ANCHOR_MODE: "merkle",
    LOCAL_CHAIN_DEMO: "true", JWT_SECRET: randomBytes(32).toString("hex"), REFRESH_SECRET: randomBytes(32).toString("hex"),
    TEMP_API_KEY: randomBytes(32).toString("hex"), DEMO_SEED_PASSWORD: randomBytes(24).toString("hex"), MQTT_TELEMETRY_SUBSCRIBER_ENABLED: "false" });
  if (streams) Object.assign(process.env, { EVENT_BACKBONE_ENABLED: "true", AUDIT_ANCHOR_ENABLED: "true", EVENT_STREAM_PREFIX: streamPrefix });
  const uri = new URL(process.env.ACCEPTANCE_MONGO_URI || "mongodb://127.0.0.1:27018/?directConnection=true"); uri.pathname = "/" + dbName; process.env.MONGO_URI = uri.toString();
  const socket = net.createServer(); await new Promise(r => socket.listen(0, "127.0.0.1", r)); const port = socket.address().port; await new Promise(r => socket.close(r));
  process.env.RPC_URL = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, ["node_modules/hardhat/internal/cli/cli.js", "node", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: path.join(root, "blockchain"), windowsHide: true, stdio: "ignore" });
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL, 31337, { staticNetwork: true });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { await provider.getBlockNumber(); ready = true; break; } catch (_) { await new Promise(r => setTimeout(r, 100)); } }
  assert.ok(ready, "Isolated chain ready");
  const wallet = i => ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/" + i).connect(provider);
  const artifact = require("../../blockchain/artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json");
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet(0)).deploy(wallet(1).address, wallet(2).address);
  await contract.waitForDeployment(); process.env.CONTRACT_ADDRESS = await contract.getAddress(); process.env.MERKLE_CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  await require("./seed").seed();
  const app = require("../server"); await mongoose.connection.asPromise();
  if (streams) {
    const consumers = require("../services/eventConsumers"); await consumers.initialize();
    await require("../services/eventBackbone").start({ persistence: consumers.persistence, "policy-alert": consumers.policyAlert,
      "ai-advisory": consumers.aiAdvisory, anchoring: consumers.anchoring });
  }
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const auth = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.synthetic.test", password: process.env.DEMO_SEED_PASSWORD, role: "admin" }) });
  assert.equal(auth.status, 200); const { token } = await auth.json();
  const call = async (method, route, role, data, expected = 200) => {
    const res = await fetch(base + route, { method, headers: { "Content-Type": "application/json", "x-correlation-id": "phase5.synthetic.acceptance",
      ...(role === "device" ? { "x-api-key": process.env.TEMP_API_KEY } : { Authorization: "Bearer " + token }) },
      ...(data ? { body: JSON.stringify(data) } : {}) });
    const body = await res.json(); assert.equal(res.status, expected, JSON.stringify(body)); return body;
  };
  const result = await require("./verifyPhase5Blockchain")(call);
  const unauth = await fetch(base + "/verify/" + result.batchId); assert.equal(unauth.status, 401);
  const metricsDir = path.join(root, "backend/data/blockchain"); await fs.mkdir(metricsDir, { recursive: true });
  const metricsFile = path.join(metricsDir, result.batchId + ".json"); await fs.writeFile(metricsFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, metricsFile, redisStreamConsumers: streams }));
  if (process.argv.includes("--preview")) {
    const express = require("express"), web = express();
    web.use("/api", (req, res) => { const upstream = require("node:http").request(base + req.url, { method: req.method, headers: req.headers }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res); }); upstream.on("error", () => res.status(502).end()); req.pipe(upstream); });
    web.use(express.static(path.join(root, "frontend/build"))); web.get("/{*path}", (_, res) => res.sendFile(path.join(root, "frontend/build/index.html")));
    previewServer = await new Promise(resolve => { const s = web.listen(0, "127.0.0.1", () => resolve(s)); });
    console.log(JSON.stringify({ previewUrl: `http://127.0.0.1:${previewServer.address().port}`, password: process.env.DEMO_SEED_PASSWORD, notice: "Disposable synthetic credentials. Auto-cleanup after 10 minutes." }));
    await new Promise(resolve => { const timer = setTimeout(resolve, 600000); const finish = () => { clearTimeout(timer); resolve(); };
      process.stdin.resume(); process.stdin.once("data", finish); process.once("SIGTERM", finish); process.once("SIGINT", finish); }); process.stdin.pause();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  for (const s of [previewServer, server]) { if (s) { s.closeAllConnections(); await new Promise(r => s.close(r)); } }
  if (streams) {
    const backbone = require("../services/eventBackbone");
    await backbone.stop();
    const redis = await backbone.connection();
    const keys = [];
    for await (const key of redis.scanIterator({ MATCH: streamPrefix + ":*" })) {
      if (!key.startsWith(streamPrefix + ":")) throw new Error("Unexpected Redis cleanup key");
      keys.push(key);
    }
    if (keys.length) await redis.del(keys);
    await backbone.stop();
  }
  if (mongoose.connection.name === dbName && /^codex_cc_test_[a-f0-9]{16}$/.test(dbName)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); provider?.destroy(); child?.kill(); console.log("Cleaned isolated synthetic database and chain; application data unchanged.");
});
