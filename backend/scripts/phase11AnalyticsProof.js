// Authorized synthetic diagnostic: approval must never change stock or dispatch.
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Batch = require("../models/Batch");

async function main() {
  assert.ok(process.env.DEMO_SEED_PASSWORD);
  await mongoose.connect(process.env.MONGO_URI);
  const base = "http://127.0.0.1:5000/api";
  const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.synthetic.test", role: "admin", password: process.env.DEMO_SEED_PASSWORD }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const call = async (method, path, payload) => {
    const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(45000) });
    const body = await response.json();
    assert.ok(response.ok, `${method} ${path} failed (${response.status}): ${body.error || "unexpected response"}`);
    return { body, status: response.status };
  };
  const { body: catalog } = await call("GET", "/forecast");
  const choice = catalog.catalog.find(row => row.ready && row.vaccineType === "Synthetic Vaccine B");
  assert.ok(choice, "Seeded Vaccine B history must be forecast-ready");
  const { body: forecast } = await call("GET", `/forecast?vaccineType=${encodeURIComponent(choice.vaccineType)}&region=${encodeURIComponent(choice.region)}&horizon=3`);
  assert.equal(forecast.forecast.provenance.synthetic, true);
  const quantities = async () => (await Batch.find({ isDemo: true }).sort({ batchId: 1 }).lean())
    .map(row => ({ batchId: row.batchId, quantity: row.quantity }));
  const before = await quantities();
  const plan = await call("POST", "/admin/forecast-plan", { runIds: [forecast.runId], destinationCapacity: 5000,
    transportCapacity: 5000, minimumShelfLifeDays: 30 });
  assert.equal(plan.status, 201);
  const approval = await call("POST", `/admin/forecast-plan/${plan.body.planId}/approve`, {
    reason: "Authorized review of synthetic Phase 11 viva diagnostic; no stock change or dispatch" });
  assert.equal(approval.body.stockChanged, false);
  assert.equal(approval.body.dispatched, false);
  assert.deepEqual(await quantities(), before);
  console.log(JSON.stringify({ result: "PASS", synthetic: true, vaccineType: choice.vaccineType,
    observedMonths: forecast.forecast.provenance.observed_months, forecastRunId: forecast.runId,
    comparison: forecast.forecast.comparison, planHttpStatus: plan.status, planId: plan.body.planId,
    allocatedDoses: plan.body.allocatedDoses, approvalHttpStatus: approval.status, stockChanged: false, dispatched: false }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
