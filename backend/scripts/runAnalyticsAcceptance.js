// Runs the real seed and APIs only in a disposable database; never reseeds the application DB.
const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const root = path.resolve(__dirname, "../..");
const dbName = `codex_cc_test_${randomBytes(8).toString("hex")}`;
let server, previewServer, aiProcess;
async function main() {
  if (!process.argv.includes("--execute")) throw new Error("Use --execute for an isolated synthetic acceptance run");
  const uri = new URL(process.env.ACCEPTANCE_MONGO_URI || "mongodb://127.0.0.1:27017"); uri.pathname = `/${dbName}`;
  process.env.MONGO_URI = uri.toString(); process.env.NODE_ENV = "test";
  for (const key of ["JWT_SECRET", "REFRESH_SECRET", "TEMP_API_KEY", "DEMO_SEED_PASSWORD"]) process.env[key] = randomBytes(32).toString("hex");
  process.env.ANALYTICS_METRICS_DIR = path.join(root, "backend/data/analytics/phase4-acceptance");
  process.env.EVENT_BACKBONE_ENABLED = "false";
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const aiPort = socket.address().port; await new Promise(resolve => socket.close(resolve));
  process.env.AI_BASE_URL = `http://127.0.0.1:${aiPort}`;
  aiProcess = spawn(process.env.PYTHON_EXECUTABLE || "python", ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(aiPort)],
    { cwd: path.join(root, "ai-services"), windowsHide: true, stdio: "ignore", env: { ...process.env, ENABLE_EXPERIMENTAL_BERT: "false" } });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (aiProcess.exitCode !== null) throw new Error("AI acceptance service exited");
    try { if ((await fetch(process.env.AI_BASE_URL, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, "AI service readiness");
  await require("./seed").seed();
  const app = require("../server"); await mongoose.connection.asPromise();
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const tokens = {};
  for (const user of require("./seed").demoUsers) {
    const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: process.env.DEMO_SEED_PASSWORD, role: user.role }) });
    const result = await response.json(); assert.equal(response.status, 200, `Fresh seed ${user.role} login`); tokens[user.role] = result.token;
  }
  async function call(method, route, role, data, status = 200) {
    const response = await fetch(`${base}${route}`, { method, headers: { authorization: `Bearer ${tokens[role]}`, "content-type": "application/json", "x-correlation-id": "phase4.synthetic.acceptance" },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(60000) });
    const result = await response.json(); assert.equal(response.status, status, `${route}: ${JSON.stringify(result)}`); return result;
  }
  const run = await require("./verifyPhase4Analytics")(call, { seeded: true });
  const catalog = await call("GET", "/forecast", "manufacturer"); assert.equal(catalog.catalog.length, 3);
  await call("GET", `/forecast?${new URLSearchParams({ vaccineType: "Synthetic Vaccine B", region: "Synthetic Demo Region", horizon: "3" })}`, "manufacturer");
  await call("GET", "/forecast", "distributor", undefined, 403);
  const saved = JSON.parse(await fs.readFile(path.join(process.env.ANALYTICS_METRICS_DIR, `${run.runId}.json`), "utf8"));
  assert.equal(saved.runId, String(run.runId));
  // Explicit isolated released-stock fixture tests the solver, not the signing workflow.
  const Batch = require("../models/Batch");
  await Batch.create({ batchId: "SYNTHETIC-ANALYTICS-RELEASED-FIXTURE", vaccineType: "Synthetic Vaccine A",
    manufacturer: "Synthetic Demo Manufacturer", quantity: 90, expiresAt: new Date(Date.now() + 365 * 86400000),
    releaseVisibleToExternal: true, productionApproved: true, labApproved: true, reportStatus: "Reported", isDemo: true });
  const stocked = await call("POST", "/admin/forecast-plan", "admin", { runIds: [run.runId], destinationCapacity: 50, transportCapacity: 40, minimumShelfLifeDays: 30 }, 201);
  assert.equal(stocked.allocatedDoses, 40); assert.ok(stocked.method.startsWith("scipy"));
  assert.equal(stocked.allocations[0].batchId, "SYNTHETIC-ANALYTICS-RELEASED-FIXTURE");
  await call("POST", `/admin/forecast-plan/${stocked.planId}/approve`, "admin", { reason: "Synthetic released-stock fixture review" });
  assert.equal((await Batch.findOne({ batchId: "SYNTHETIC-ANALYTICS-RELEASED-FIXTURE" })).quantity, 90);
  const anomaly = await fetch(`${process.env.AI_BASE_URL}/anomaly/detect`, { method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": "phase4.synthetic.acceptance" },
    body: JSON.stringify({ temperature: 12, humidity: 90, history: Array.from({ length: 8 }, () => ({ temperature: 5, humidity: 60 })) }) });
  assert.equal(anomaly.status, 200); const explanation = await anomaly.json();
  assert.equal(explanation.label, "ANOMALY"); assert.ok(explanation.contributions[0].text.includes("7")); assert.equal(explanation.advisory_only, true);
  console.log(JSON.stringify({ releasedFixtureAllocation: 40, stockAfterReview: 90, anomalyLabel: explanation.label, contributionCount: explanation.contributions.length }));
  await Batch.deleteOne({ batchId: "SYNTHETIC-ANALYTICS-RELEASED-FIXTURE" });
  console.log(JSON.stringify({ metricsFile: path.join(process.env.ANALYTICS_METRICS_DIR, `${run.runId}.json`), freshSeedLogins: 4, status: "PASS" }));
  if (process.argv.includes("--preview")) {
    // Serve the actual production frontend with a same-origin API, isolated from live app data.
    const express = require("express"), preview = express();
    preview.use("/api", (req, res) => {
      const upstream = require("node:http").request(`${base}${req.url}`, { method: req.method, headers: req.headers }, incoming => {
        res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
      });
      upstream.on("error", () => { if (!res.headersSent) res.status(502).end(); }); req.pipe(upstream);
    });
    preview.use(express.static(path.join(root, "frontend/build")));
    preview.get("/{*path}", (req, res) => res.sendFile(path.join(root, "frontend/build/index.html")));
    previewServer = await new Promise(resolve => { const s = preview.listen(0, "127.0.0.1", () => resolve(s)); });
    console.log(JSON.stringify({ previewUrl: `http://127.0.0.1:${previewServer.address().port}`, syntheticPreviewPassword: process.env.DEMO_SEED_PASSWORD, notice: "Disposable test credentials only; send exit to clean up; auto-cleanup in 20 minutes." }));
    await new Promise(resolve => { const timer = setTimeout(resolve, 1200000); const finish = () => { clearTimeout(timer); resolve(); };
      process.stdin.resume(); process.stdin.once("data", finish); process.once("SIGINT", finish); process.once("SIGTERM", finish); });
    process.stdin.pause();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  previewServer?.closeAllConnections(); if (previewServer) await new Promise(resolve => previewServer.close(resolve));
  server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState && mongoose.connection.name === dbName && /^codex_cc_test_[a-f0-9]{16}$/.test(dbName)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); aiProcess?.kill();
  console.log("Cleaned this run's disposable database and AI process; retained synthetic thesis JSON metrics; application database unchanged.");
});
