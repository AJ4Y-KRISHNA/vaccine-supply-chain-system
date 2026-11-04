const assert = require("node:assert/strict");
const Order = require("../models/Order");
const Batch = require("../models/Batch");
const Run = require("../models/ForecastRun");
const { buildSyntheticOrderHistory } = require("./seed");

module.exports = async function verifyPhase4(call, { seeded = false } = {}) {
  if (!seeded) await Order.insertMany(buildSyntheticOrderHistory(), { timestamps: false });
  const catalog = await call("GET", "/forecast", "admin");
  assert.equal(catalog.catalog.filter(row => row.ready).length, 3);
  const vaccineType = "Synthetic Vaccine A", region = "Synthetic Demo Region";
  const forecast = await call("GET", `/forecast?${new URLSearchParams({ vaccineType, region, horizon: "6" })}`, "admin");
  assert.equal(forecast.forecast.provenance.synthetic, true);
  assert.equal(forecast.forecast.provenance.observation_count, 35);
  assert.equal(forecast.forecast.forecast_periods.length, 6);
  assert.ok(forecast.forecast.comparison.some(row => row.model.startsWith("SARIMA") && row.status === "evaluated"));
  assert.ok(forecast.forecast.forecast_periods.every(row => row.lower <= row.demand_doses && row.demand_doses <= row.upper));
  assert.ok(await Run.exists({ _id: forecast.runId }));
  const metrics = await call("GET", `/forecast/${forecast.runId}/metrics`, "admin");
  assert.equal(metrics.synthetic, true); assert.ok(metrics.comparison[0].rmse >= 0);
  const inventoryBefore = JSON.stringify(await Batch.find().sort({ batchId: 1 }).lean());
  const plan = await call("POST", "/admin/forecast-plan", "admin", { runIds: [forecast.runId], destinationCapacity: 500, transportCapacity: 500, minimumShelfLifeDays: 30 }, 201);
  if (seeded) { assert.equal(plan.allocatedDoses, 0); assert.ok(plan.exclusions.every(row => row.reasons.includes("BATCH_NOT_RELEASED"))); }
  await call("POST", `/admin/forecast-plan/${plan.planId}/approve`, "manufacturer", { reason: "Synthetic forbidden approval check" }, 403);
  const approval = await call("POST", `/admin/forecast-plan/${plan.planId}/approve`, "admin", { reason: "Synthetic human review of forecast recommendation" });
  assert.equal(approval.stockChanged, false); assert.equal(approval.dispatched, false);
  assert.equal(JSON.stringify(await Batch.find().sort({ batchId: 1 }).lean()), inventoryBefore);
  console.log(JSON.stringify({ phase: 4, outcome: "PASS", synthetic: true, months: 35,
    model: forecast.forecast.model, comparison: metrics.comparison, metricsRunId: forecast.runId,
    allocatedDoses: plan.allocatedDoses, approvalStockChanged: false, automaticDispatch: false }));
  return forecast;
};
