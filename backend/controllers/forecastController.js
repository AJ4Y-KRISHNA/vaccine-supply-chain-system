const Order = require("../models/Order");
const { getForecast } = require("../services/aiService");

const DEFAULT_MONTHS = 12;
const MIN_MONTHS = 6;
const MAX_MONTHS = 60;
const DEFAULT_HORIZON = 6;

function validMonths(value) {
  const months = value === undefined ? DEFAULT_MONTHS : Number(value);
  return Number.isInteger(months) && months >= MIN_MONTHS && months <= MAX_MONTHS ? months : null;
}

function validHorizon(value) {
  const horizon = value === undefined ? DEFAULT_HORIZON : Number(value);
  return Number.isInteger(horizon) && horizon >= 1 && horizon <= 24 ? horizon : null;
}

function periodLabels(start, count) {
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

async function loadOrderDemandSeries({ scope = {}, months = DEFAULT_MONTHS, vaccineType, now = new Date() } = {}) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1));
  const monthLabels = periodLabels(start, months);
  const match = {
    $and: [
      scope.order || {},
      { createdAt: { $gte: start, $lt: end } },
      { status: { $nin: ["Cancelled", "Canceled", "Rejected"] } },
      { requestedDoses: { $type: "number", $gt: 0 } },
      ...(vaccineType ? [{ vaccineType }] : []),
    ],
  };
  const aggregates = await Order.aggregate([
    { $match: match },
    { $project: { vaccineType: 1, requestedDoses: 1, isDemo: 1, month: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } } } },
    { $group: { _id: { vaccineType: "$vaccineType", month: "$month" }, demandDoses: { $sum: "$requestedDoses" }, orderCount: { $sum: 1 }, syntheticCount: { $sum: { $cond: ["$isDemo", 1, 0] } } } },
    { $sort: { "_id.vaccineType": 1, "_id.month": 1 } },
  ]);

  const totalsByProduct = new Map();
  for (const row of aggregates) {
    const type = String(row._id?.vaccineType || "").trim();
    if (type) totalsByProduct.set(type, (totalsByProduct.get(type) || 0) + Number(row.demandDoses || 0));
  }
  const selectedVaccineType = vaccineType || [...totalsByProduct.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (!selectedVaccineType) {
    const error = new Error("No persisted order demand is available for the selected account and period.");
    error.status = 422;
    throw error;
  }
  const selectedRows = aggregates.filter(row => row._id?.vaccineType === selectedVaccineType);
  const observedMonths = new Set(selectedRows.map(row => row._id.month));
  if (observedMonths.size < MIN_MONTHS) {
    const error = new Error(`At least ${MIN_MONTHS} distinct months of persisted orders are required; ${observedMonths.size} month(s) are available for ${selectedVaccineType}.`);
    error.status = 422;
    throw error;
  }
  const byMonth = new Map(selectedRows.map(row => [row._id.month, Number(row.demandDoses)]));
  const series = monthLabels.map(month => byMonth.get(month) || 0);
  const orderCount = selectedRows.reduce((total, row) => total + Number(row.orderCount || 0), 0);
  const syntheticCount = selectedRows.reduce((total, row) => total + Number(row.syntheticCount || 0), 0);
  return {
    series,
    provenance: {
      source: "MongoDB persisted Order records",
      verification: "aggregated from authenticated, organization-scoped order records",
      synthetic: syntheticCount === orderCount && orderCount > 0 ? true : syntheticCount > 0 ? null : false,
      synthetic_order_count: syntheticCount,
      period: "month",
      first_period: monthLabels[0],
      last_period: monthLabels.at(-1),
      vaccine_type: selectedVaccineType,
      order_count: orderCount,
      observed_order_months: observedMonths.size,
      observation_count: series.length,
      source_collection: "orders",
    },
  };
}

exports.getForecast = async (req, res) => {
  const months = validMonths(req.body?.months);
  const horizon = validHorizon(req.body?.horizon);
  const vaccineType = req.body?.vaccineType === undefined ? undefined : String(req.body.vaccineType).trim();
  if (!months) return res.status(400).json({ error: `months must be a whole number from ${MIN_MONTHS} to ${MAX_MONTHS}` });
  if (!horizon) return res.status(400).json({ error: "horizon must be a whole number from 1 to 24" });
  if (vaccineType !== undefined && (!vaccineType || vaccineType.length > 120)) return res.status(400).json({ error: "vaccineType must contain 1–120 characters" });

  try {
    let vaccinationData = req.body?.vaccination_data;
    let provenance = req.body?.provenance;
    if (!Array.isArray(vaccinationData)) {
      const loaded = await loadOrderDemandSeries({ scope: req.scope || {}, months, vaccineType });
      vaccinationData = loaded.series;
      provenance = loaded.provenance;
    } else if (!provenance) {
      provenance = { source: "explicit caller-provided history", verification: "unverified input", synthetic: null };
    }
    const response = await getForecast({ vaccination_data: vaccinationData, provenance, horizon });
    return res.json({ message: "Multi-period demand forecast generated from the supplied order history", forecast: response });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.status === 422 ? error.message : "AI forecast service unavailable" });
  }
};

exports.loadOrderDemandSeries = loadOrderDemandSeries;
exports.validMonths = validMonths;
exports.validHorizon = validHorizon;
