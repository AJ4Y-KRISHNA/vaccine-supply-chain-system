const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const ForecastRun = require("../models/ForecastRun");
const SupplyPlan = require("../models/SupplyPlan");
const Approval = require("../models/ForecastPlanApproval");
const ai = require("../services/aiService");
const { inventorySnapshot } = require("../services/inventoryEligibility");
const { identityPatterns } = require("../middleware/identityScope");
const logger = require("../services/structuredLogger");

const fail = (status, message) => Object.assign(new Error(message), { status });
const actor = req => req.user.id || req.user._id;
const period = date => date.toISOString().slice(0, 7);
function demandScope(req) {
  return req.user.role === "manufacturer" ? { manufacturer: { $in: identityPatterns(req.user) } } : req.scope?.order || {};
}
async function histories(req) {
  const end = new Date(); end.setUTCDate(1); end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 120);
  const rows = await Order.aggregate([
    { $match: { $and: [demandScope(req), { isDemo: true, createdAt: { $gte: start, $lt: end },
      status: { $nin: ["Cancelled", "Canceled", "Rejected"] }, requestedDoses: { $gt: 0, $type: "number" } }] } },
    { $group: { _id: { vaccineType: "$vaccineType", region: "$region",
      month: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } } }, doses: { $sum: "$requestedDoses" } } },
    { $sort: { "_id.month": 1 } },
  ]);
  const groups = new Map();
  for (const row of rows) {
    if (!row._id.vaccineType || !row._id.region) continue;
    const key = JSON.stringify([row._id.vaccineType, row._id.region]);
    if (!groups.has(key)) groups.set(key, { vaccineType: row._id.vaccineType, region: row._id.region, months: new Map() });
    groups.get(key).months.set(row._id.month, row.doses);
  }
  return [...groups.values()].sort((a, b) => a.vaccineType.localeCompare(b.vaccineType) || a.region.localeCompare(b.region)).map(group => {
    const cursor = new Date(`${[...group.months.keys()].sort()[0]}-01T00:00:00Z`);
    const labels = [], values = [];
    while (cursor < end) { labels.push(period(cursor)); values.push(group.months.get(period(cursor)) || 0); cursor.setUTCMonth(cursor.getUTCMonth() + 1); }
    return { vaccineType: group.vaccineType, region: group.region, labels, values, observedMonths: group.months.size };
  });
}
async function exportMetrics(run) {
  const directory = process.env.ANALYTICS_METRICS_DIR || path.resolve(__dirname, "../data/analytics");
  await fs.mkdir(directory, { recursive: true });
  const record = { schema_version: 1, synthetic: true, clinical_use: false, runId: String(run._id),
    vaccineType: run.vaccineType, region: run.region, createdAt: run.createdAt,
    provenance: run.result.provenance, model: run.result.model, comparison: run.result.comparison,
    interval_method: run.result.interval_method, confidence_level: run.result.confidence_level,
    library_versions: run.result.library_versions,
    history_periods: run.result.history_periods, history: run.result.history,
    history_sha256: crypto.createHash("sha256").update(JSON.stringify(run.result.history)).digest("hex"),
    forecast_periods: run.result.forecast_periods,
    limitations: run.result.limitations };
  const target = path.join(directory, `${run._id}.json`);
  await fs.writeFile(`${target}.tmp`, JSON.stringify(record, null, 2));
  await fs.rename(`${target}.tmp`, target);
  return record;
}
exports.getRegional = async (req, res) => {
  try {
    const catalog = await histories(req);
    if (!req.query.vaccineType && !req.query.region) return res.json({ synthetic: true,
      catalog: catalog.map(({ vaccineType, region, values, observedMonths }) => ({ vaccineType, region, months: values.length, observedMonths, ready: observedMonths >= 30 })) });
    const horizon = Number(req.query.horizon || 6);
    if (!Number.isInteger(horizon) || horizon < 3 || horizon > 6) throw fail(400, "horizon must be 3–6 months");
    const selected = catalog.find(row => row.vaccineType === req.query.vaccineType && row.region === req.query.region);
    if (!selected) throw fail(404, "No synthetic history in your organization scope for that vaccine/region");
    if (selected.observedMonths < 30) throw fail(422, "At least 30 observed complete months are required for SARIMA comparison");
    const result = await ai.getRegionalForecast({ values: selected.values, horizon, last_period: selected.labels.at(-1) }, req.correlationId);
    result.history_periods = selected.labels;
    result.provenance = { source: "MongoDB synthetic Order history", synthetic: true, observation_count: selected.values.length,
      observed_months: selected.observedMonths, vaccine_type: selected.vaccineType, region: selected.region,
      first_period: selected.labels[0], last_period: selected.labels.at(-1), missing_months: selected.values.length - selected.observedMonths,
      note: "Complete UTC months only; absent months treated as zero recorded demand; current partial month excluded." };
    const run = await ForecastRun.create({ createdBy: actor(req), ...selected, result, correlationId: req.correlationId });
    await exportMetrics(run);
    res.json({ forecast: result, runId: run._id, metricsUrl: `/api/forecast/${run._id}/metrics` });
  } catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : "Regional analytics or metrics export unavailable" }); }
};
exports.getMetrics = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw fail(400, "Invalid forecast run ID");
    const run = await ForecastRun.findOne({ _id: req.params.id, createdBy: actor(req) }).lean();
    if (!run) throw fail(404, "Forecast run not found in your account");
    const record = await exportMetrics(run);
    res.set("Content-Disposition", `attachment; filename="synthetic-forecast-${run._id}.json"`).json(record);
  } catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : "Metrics export unavailable" }); }
};
function bounded(value, name, maximum = 10000000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw fail(400, `${name} must be an integer from 0 to ${maximum}`);
  return value;
}
function fingerprint(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(rows.map(row => ({ batchId: row.batchId, vaccineType: row.vaccineType,
    remainingDoses: row.remainingDoses, eligible: row.eligible, expiresAt: row.expiresAt || null, reasons: row.reasons })).sort((a, b) => a.batchId.localeCompare(b.batchId)))).digest("hex");
}
exports.createPlan = async (req, res) => {
  try {
    const { runIds, destinationCapacity, transportCapacity, minimumShelfLifeDays = 30 } = req.body;
    if (!Array.isArray(runIds) || !runIds.length || runIds.length > 30 || runIds.some(id => !mongoose.isValidObjectId(id))) throw fail(400, "Provide 1–30 valid forecast run IDs");
    bounded(destinationCapacity, "Destination capacity"); bounded(transportCapacity, "Transport capacity"); bounded(minimumShelfLifeDays, "Minimum shelf life", 365);
    const runs = await ForecastRun.find({ _id: { $in: runIds }, createdBy: actor(req), isDemo: true }).lean();
    if (runs.length !== runIds.length) throw fail(404, "Forecast runs not found in your account");
    if (new Set(runs.map(r => `${r.vaccineType}\0${r.region}`)).size !== runs.length) throw fail(400, "One forecast run per vaccine and region is allowed");
    const targetPeriods = new Set(runs.map(r => r.result.forecast_periods[0].period));
    if (targetPeriods.size !== 1) throw fail(400, "Forecast runs must target the same month");
    const targetMonth = [...targetPeriods][0];
    const arrival = new Date(`${targetMonth}-01T00:00:00Z`);
    const now = new Date(); const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if (arrival < monthStart || runs.some(run => +now - +new Date(run.createdAt) > 86400000)) throw fail(409, "Forecast is stale; generate a new run");
    const shelfDeadline = Math.max(+arrival, +now) + minimumShelfLifeDays * 86400000;
    const snapshot = await inventorySnapshot();
    const demoBatchIds = await require("../models/Batch").find({ isDemo: true }).distinct("batchId");
    const inventory = snapshot.filter(row => demoBatchIds.includes(row.batchId) && row.eligible && row.expiresAt && +new Date(row.expiresAt) > shelfDeadline)
      .sort((a, b) => +new Date(a.expiresAt) - +new Date(b.expiresAt));
    const demand = runs.map(run => ({ vaccineType: run.vaccineType, region: run.region,
      doses: run.result.forecast_periods[0].demand_doses, capacity: destinationCapacity }));
    const result = await ai.getForecastAllocation({ inventory, demand, capacity: transportCapacity }, req.correlationId);
    result.synthetic = true;
    result.exclusions = snapshot.filter(row => !inventory.includes(row)).map(row => ({ batchId: row.batchId, reasons: row.reasons.length ? row.reasons : ["NOT_SYNTHETIC_OR_INSUFFICIENT_SHELF_LIFE"] }));
    result.assumptions.push(`Only the first forecast month (${targetMonth}) is planned; expiry must exceed arrival plus ${minimumShelfLifeDays} days.`,
      "Destination capacity is shared across forecast products in each region.",
      "Approval records human review only; it does not reserve inventory, create orders or dispatch. Existing authorized order workflows remain required.");
    const inputs = { type: "synthetic-forecast", runIds, destinationCapacity, transportCapacity, minimumShelfLifeDays, targetMonth,
      inventoryFingerprint: fingerprint(snapshot) };
    const plan = await SupplyPlan.create({ createdBy: actor(req), inputs, result });
    logger.info("analytics.plan.created", { correlationId: req.correlationId, planId: String(plan._id), synthetic: true });
    res.status(201).json({ planId: plan._id, ...result });
  } catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : "Forecast allocation unavailable" }); }
};
exports.approvePlan = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw fail(400, "Invalid plan ID");
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 1000) throw fail(400, "Review reason must contain 10–1000 characters");
    const plan = await SupplyPlan.findOne({ _id: req.params.id, createdBy: actor(req), "inputs.type": "synthetic-forecast" }).lean();
    if (!plan) throw fail(404, "Forecast plan not found in your account");
    const now = new Date();
    if (new Date(`${plan.inputs.targetMonth}-01T00:00:00Z`) < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) || +now - +new Date(plan.createdAt) > 86400000) throw fail(409, "Forecast plan is stale");
    if (fingerprint(await inventorySnapshot()) !== plan.inputs.inventoryFingerprint) throw fail(409, "Inventory changed; generate and review a new plan");
    let approval = await Approval.findOne({ planId: plan._id }).lean();
    if (!approval) {
      try { approval = await Approval.create({ planId: plan._id, approvedBy: actor(req), reason, correlationId: req.correlationId }); }
      catch (error) { if (error.code !== 11000) throw error; approval = await Approval.findOne({ planId: plan._id }).lean(); }
    }
    logger.info("analytics.plan.approved", { correlationId: req.correlationId, planId: String(plan._id), synthetic: true });
    res.json({ approval, stockChanged: false, dispatched: false });
  } catch (error) { res.status(error.status || 503).json({ error: error.status ? error.message : "Plan approval unavailable" }); }
};
exports.histories = histories;
exports.fingerprint = fingerprint;
