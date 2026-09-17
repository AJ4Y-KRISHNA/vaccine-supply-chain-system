// Actual HTTP/AI/Mongo/local-chain acceptance. Only a newly generated test DB is written.
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const root = path.resolve(__dirname, "../..");
const children = [];
const dbName = `codex_cc_test_${randomBytes(8).toString("hex")}`;
let server, provider;
const measurements = [];
async function freePort() {
  const s = net.createServer(); await new Promise(resolve => s.listen(0, "127.0.0.1", resolve));
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port;
}
function start(command, args, cwd) {
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ENABLE_EXPERIMENTAL_BERT: "false" } });
  child.diagnostics = ""; child.stderr.on("data", b => { child.diagnostics = (child.diagnostics + b).slice(-2000); });
  children.push(child); return child;
}
async function ready(url, child, body) {
  for (let count = 0; count < 120; count++) {
    if (child.exitCode !== null) throw new Error(`Local service exited: ${child.diagnostics}`);
    try { const r = await fetch(url, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Local test service did not become ready");
}
async function main() {
  if (!process.argv.includes("--execute")) throw new Error("Run with --execute to create and remove an isolated synthetic test database and local test services");
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = randomBytes(32).toString("hex"); process.env.REFRESH_SECRET = randomBytes(32).toString("hex"); process.env.TEMP_API_KEY = randomBytes(32).toString("hex");
  process.env.MONGO_URI = `mongodb://127.0.0.1:27017/${dbName}`;
  process.env.LOCAL_CHAIN_DEMO = "true"; process.env.AUDIT_ANCHOR_ENABLED = "false";
  const chainPort = await freePort(), aiPort = await freePort();
  process.env.RPC_URL = `http://127.0.0.1:${chainPort}`;
  process.env.AI_BASE_URL = `http://127.0.0.1:${aiPort}`;
  const chainProcess = start(process.execPath, ["node_modules/hardhat/internal/cli/cli.js", "node", "--hostname", "127.0.0.1", "--port", String(chainPort)], path.join(root, "blockchain"));
  const aiProcess = start(process.env.PYTHON_EXECUTABLE || "python", ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(aiPort)], path.join(root, "ai-services"));
  await Promise.all([ready(process.env.RPC_URL, chainProcess, { jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }), ready(process.env.AI_BASE_URL, aiProcess)]);
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = index => ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, `m/44'/60'/0'/0/${index}`).connect(provider);
  const artifact = require("../../blockchain/artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json");
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet(0)).deploy(wallet(1).address, wallet(2).address);
  await contract.waitForDeployment(); process.env.CONTRACT_ADDRESS = await contract.getAddress();
  const app = require("../server"); await mongoose.connection.asPromise();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const User = require("../models/user"), Batch = require("../models/Batch"), Alert = require("../models/TemperatureAlert");
  const password = randomBytes(24).toString("hex"), hashed = await require("bcryptjs").hash(password, 10);
  const actors = {};
  for (const role of ["admin", "manufacturer", "distributor", "healthcare"]) {
    actors[role] = await User.create({ email: `${role}@acceptance.example.test`, password: hashed, role,
      manufacturer: role === "manufacturer" ? "SYNTHETIC Maker" : undefined,
      distributor: role === "distributor" ? "SYNTHETIC Distributor" : undefined,
      hospital: role === "healthcare" ? "SYNTHETIC Hospital" : undefined, canReviewColdChain: role === "admin" });
  }
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(method, route, role, body, expected = 200) {
    const start = performance.now();
    const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", ...(actors[role]?.token ? { Authorization: `Bearer ${actors[role].token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const data = await response.json(); measurements.push({ route, status: response.status, ms: Math.round(performance.now() - start) });
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`); return data;
  }
  for (const role of Object.keys(actors)) actors[role].token = (await call("POST", "/auth/login", null, { email: actors[role].email, role, password })).token;
  console.log("Acceptance: authenticated four isolated synthetic accounts");
  const batchId = "SYSTEM-ACCEPTANCE-DEMO", vaccineType = "SYNTHETIC TEST PRODUCT — NOT CLINICAL";
  await call("POST", "/manufacturer/raw-materials", "manufacturer", { batchId, supplier: "SYNTHETIC Supplier", quantity: 100, materialType: "SYNTHETIC ONLY", unit: "test units" });
  await call("POST", "/manufacturer/produce", "manufacturer", { batchId, vaccineType, quantity: 100 });
  const manufactured = await call("POST", "/manufacturer/batch", "manufacturer", { batchId, vaccineType, quantity: 100, expiresAt: "2030-12-31T00:00:00Z" });
  await call("POST", "/manufacturer/batch/report", "manufacturer", { batchId, vaccineType, quantity: 100, materialQuantity: 100, remarks: "SYNTHETIC fixture quality report only" });
  assert.equal(manufactured.batch.releaseVisibleToExternal, false);
  await call("POST", `/manufacturer/batch/${batchId}/sign-release`, "manufacturer", { role: "Production" });
  await call("POST", `/manufacturer/batch/${batchId}/sign-release`, "manufacturer", { role: "Lab Testing" });
  assert.equal((await contract.getReleaseState(batchId))[2], true);
  assert.equal((await call("GET", `/batches/verify/${batchId}`, "admin")).verified, true);
  const forecast = await call("POST", "/forecast", "admin", { vaccination_data: Array.from({ length: 24 }, (_, i) => 20 + i) });
  assert.equal(forecast.forecast.predicted_demand, 44);
  const order = await call("POST", "/orders/hospital", "healthcare", { vaccineType, requestedDoses: 40, priority: "High", notes: "Synthetic acceptance order" }, 201);
  const plan = await call("POST", "/admin/supply-plan", "admin", { asOf: "2026-09-17T10:00:00Z", transportCapacityDoses: 50,
    destinations: [{ orderId: order.orderId, freeCapacityDoses: 40, transitHours: 2 }] }, 201);
  assert.equal(plan.totalAllocated, 40); assert.equal(plan.allocations[0].batchId, batchId);
  const approved = await call("PATCH", `/orders/${order.orderId}/review`, "admin", { decision: "approve", batchId, distributor: "SYNTHETIC Distributor" });
  const shipmentId = approved.shipmentId, deviceId = "SYSTEM-ACCEPTANCE-IOT";
  await call("POST", "/shipments/create", "admin", { shipmentId: "OVERALLOCATE", batchId, quantity: 61 }, 409);
  await call("POST", `/alerts/policies/batch/${batchId}/approve`, "admin", {
    minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 40, maximumHumidity: 80, excursionDurationMs: 120000,
    maximumReadingGapMs: 90000, criticalBatteryPercent: 10, maximumRateCelsiusPerMinute: 100,
    sourceReference: "SYNTHETIC SOFTWARE TEST ONLY", approvalReason: "Fixture only, not product or medical approval" }, 201);
  await call("POST", "/simulator/devices", "admin", { deviceId, vehicleId: "DEMO-TRUCK", batchId, shipmentId, scenario: "HIGH_TEMPERATURE",
    seed: "system-acceptance-v1", startTime: "2026-01-01T00:00:00.000Z", tickIntervalMs: 60000, temperatureRange: { min: 2, max: 8 } }, 201);
  for (let i = 0; i < 3; i++) await call("POST", `/simulator/${deviceId}/tick`, "admin");
  const alert = await Alert.findOne({ batchId, requiresQualityReview: true }); assert.ok(alert);
  await call("PATCH", `/distribution/distributor/supply/${shipmentId}`, "distributor", {}, 409);
  await call("POST", "/vaccinations/administer", "healthcare", { batchId, dosesUsed: 1 }, 409);
  for (const role of Object.keys(actors)) {
    const list = await call("GET", `/alerts?batchId=${batchId}`, role);
    assert.ok(list.alerts.some(row => row.alertId === alert.alertId));
  }
  await call("POST", `/simulator/${deviceId}/scenario`, "admin", { scenario: "NORMAL" });
  const normal = await call("POST", `/simulator/${deviceId}/tick`, "admin");
  assert.equal(normal.persistedReading.evaluation.batchQuarantined, true);
  const review = { asOf: normal.reading.timestamp, reason: "Synthetic software acceptance review; no clinical material" };
  await call("PATCH", `/alerts/${alert.alertId}/clear`, "admin", review, 409);
  await call("PATCH", `/alerts/${alert.alertId}/review`, "admin", review);
  await call("PATCH", `/alerts/${alert.alertId}/clear`, "admin", review);
  assert.equal((await Batch.findOne({ batchId })).coldChainHoldAlertIds.length, 0);
  await call("PATCH", `/distribution/distributor/verify/${shipmentId}`, "distributor", {});
  await call("PATCH", `/distribution/distributor/supply/${shipmentId}`, "distributor", {});
  const delivered = await call("PATCH", `/distribution/healthcare/confirm/${shipmentId}`, "healthcare", { hospital: "SYNTHETIC Hospital" });
  assert.equal(delivered.shipment.hospitalConfirmed, true);
  const anchors = await require("../services/auditAnchoring").processOnce(200); assert.equal(anchors.failed, 0); assert.ok(anchors.confirmed >= 6);
  const evidence = await call("GET", `/batches/${batchId}/audit-anchors`, "admin"); assert.ok(evidence.entries.every(entry => entry.verified));
  const replay = await require("../services/auditAnchoring").processOnce(200); assert.equal(replay.confirmed, 0);
  // Preserve proof metrics, not the disposable clinical-looking records.
  const ticks = measurements.filter(row => row.route.endsWith("/tick")).map(row => row.ms).sort((a, b) => a - b);
  console.log(JSON.stringify({ outcome: "PASS", scope: "isolated synthetic local services, not production or clinical validation",
    httpRequests: measurements.length, forecast: { model: forecast.forecast.model, predictedDemand: forecast.forecast.predicted_demand },
    manufacturedDoses: 100, allocatedDoses: 40, deliveredDoses: 40, telemetryReadings: ticks.length,
    anchoredAuditEvents: evidence.entries.length, verifiedAuditEvents: evidence.entries.filter(entry => entry.verified).length,
    tickLatencyMs: { min: ticks[0], max: ticks.at(-1), median: ticks[Math.floor(ticks.length / 2)] },
    elapsedSimulationToQuarantineMs: alert.excursionDurationMs, chainId: 31337, checks: ["manufacture", "two-address release", "forecast", "capacity plan", "traceable approval", "over-allocation rejected", "quarantine blocks dispatch and administration", "all-role alert visibility", "review required before clear", "delivery", "audit anchor verification and replay"] }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (server) { require("../controllers/simulatorController").simulatorManager.clear(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (mongoose.connection.readyState && mongoose.connection.name === dbName && /^codex_cc_test_[a-f0-9]{16}$/.test(dbName)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); provider?.destroy();
  for (const child of children) child.kill();
  console.log("Cleaned only this run's isolated test database and stopped its local child services; application database unchanged.");
});
