const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const TemperatureLog = require("../models/TemperatureLog");
const ColdChainPolicy = require("../models/ColdChainPolicy");
const mongoose = require("mongoose");

function validLimit(value) {
  if (value === undefined) return 25;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

exports.listLiveShipments = async (req, res) => {
  const limit = validLimit(req.query.limit);
  const requestedId = String(req.query.shipmentId || "").trim();
  if (!limit) return res.status(400).json({ error: "Limit must be a whole number from 1 to 100" });
  if (requestedId.length > 120) return res.status(400).json({ error: "Invalid shipment identifier" });

  try {
    const scopedShipmentFilter = requestedId
      ? { $and: [req.scope.shipment, { shipmentId: requestedId }] }
      : req.scope.shipment;
    const shipments = await Shipment.find(scopedShipmentFilter)
      .select("shipmentId orderId batchId vaccineType quantity destination distributor status statusHistory coldChainStatus coldChainHoldAlertIds hospitalConfirmed hospitalConfirmedAt lastUpdatedAt createdAt")
      .sort({ lastUpdatedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    if (requestedId && !shipments.length) return res.status(404).json({ error: "Shipment not found or not visible to this account" });

    const batchIds = [...new Set(shipments.map(item => item.batchId).filter(Boolean))];
    const batches = batchIds.length
      ? await Batch.find({ $and: [req.scope.batch, { batchId: { $in: batchIds } }] })
        .select("batchId vaccineType status coldChainStatus coldChainHoldAlertIds coldChainPolicyId disposition")
        .lean()
      : [];
    const batchById = new Map(batches.map(batch => [batch.batchId, batch]));
    const policyIds = batches.map(batch => batch.coldChainPolicyId).filter(Boolean);
    const policies = policyIds.length
      ? await ColdChainPolicy.find({ _id: { $in: policyIds } })
        .select("batchId minimumTemperature maximumTemperature minimumHumidity maximumHumidity excursionDurationMs maximumReadingGapMs criticalBatteryPercent approvedAt sourceReference")
        .lean()
      : [];
    const policyById = new Map(policies.map(policy => [String(policy._id), policy]));

    // A reading without a shipmentId cannot safely be assigned when a batch has
    // multiple shipments, so this view deliberately requires an exact link.
    const shipmentIds = shipments.map(item => item.shipmentId).filter(Boolean);
    const readings = shipmentIds.length
      ? await TemperatureLog.aggregate([
        { $match: { $and: [req.scope.telemetry, { shipmentId: { $in: shipmentIds } }] } },
        { $sort: { recordedAt: -1, _id: -1 } },
        { $group: { _id: "$shipmentId", reading: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$reading" } },
      ])
      : [];
    const readingByShipmentId = new Map(readings.map(reading => [reading.shipmentId, reading]));

    const result = shipments.map(shipment => {
      const batch = batchById.get(shipment.batchId) || null;
      const policy = batch?.coldChainPolicyId ? policyById.get(String(batch.coldChainPolicyId)) || null : null;
      const reading = readingByShipmentId.get(shipment.shipmentId) || null;
      return {
        ...shipment,
        batchStatus: batch?.status || null,
        batchColdChainStatus: batch?.coldChainStatus || null,
        batchColdChainHoldAlertIds: batch?.coldChainHoldAlertIds || [],
        batchDisposition: batch?.disposition || null,
        policy: policy ? {
          minimumTemperature: policy.minimumTemperature,
          maximumTemperature: policy.maximumTemperature,
          minimumHumidity: policy.minimumHumidity,
          maximumHumidity: policy.maximumHumidity,
          criticalBatteryPercent: policy.criticalBatteryPercent,
          approvedAt: policy.approvedAt,
          sourceReference: policy.sourceReference,
        } : null,
        latestTelemetry: reading ? {
          deviceId: reading.deviceId || reading.sensorId || null,
          vehicleId: reading.vehicleId || null,
          temperature: reading.temperature ?? null,
          humidity: reading.humidity ?? null,
          batteryLevel: reading.batteryLevel ?? null,
          location: reading.location || null,
          recordedAt: reading.recordedAt || null,
          source: reading.source || reading.simulation?.telemetrySource || null,
        } : null,
      };
    });
    return res.json({ shipments: result, total: result.length, limit, role: req.user.role });
  } catch (error) {
    return res.status(503).json({ error: "Live shipment data is temporarily unavailable" });
  }
};

function parseHistoryCursor(value) {
  if (!value) return null;
  if (typeof value !== "string" || value.length > 256) return undefined;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    const recordedAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (separator < 1 || !Number.isFinite(+recordedAt) || !/^[a-f\d]{24}$/i.test(id)) return undefined;
    return { recordedAt, _id: new mongoose.Types.ObjectId(id) };
  } catch (_) { return undefined; }
}

function encodeHistoryCursor(record) {
  return Buffer.from(`${new Date(record.recordedAt).toISOString()}|${record._id}`).toString("base64url");
}

exports.getShipmentTemperatureHistory = async (req, res) => {
  const shipmentId = String(req.params.shipmentId || "").trim();
  const limit = req.query.limit === undefined ? 500 : Number(req.query.limit);
  const cursor = parseHistoryCursor(req.query.cursor);
  const latest = req.query.latest === "true";
  if (!shipmentId || shipmentId.length > 120) return res.status(400).json({ error: "Invalid shipment identifier" });
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return res.status(400).json({ error: "Limit must be a whole number from 1 to 1000" });
  if (req.query.latest !== undefined && !["true", "false"].includes(String(req.query.latest))) return res.status(400).json({ error: "Latest must be true or false" });
  if (req.query.cursor !== undefined && !cursor) return res.status(400).json({ error: "Invalid history cursor" });
  if (latest && cursor) return res.status(400).json({ error: "Latest-history mode does not accept a cursor" });

  try {
    const shipment = await Shipment.findOne({ $and: [req.scope.shipment, { shipmentId }] }).select("shipmentId batchId").lean();
    if (!shipment) return res.status(404).json({ error: "Shipment not found or not visible to this account" });
    const clauses = [req.scope.telemetry, { shipmentId }];
    if (cursor) clauses.push({ $or: [
      { recordedAt: { $gt: cursor.recordedAt } },
      { recordedAt: cursor.recordedAt, _id: { $gt: cursor._id } },
    ] });
    let rows = await TemperatureLog.find({ $and: clauses })
      .select("batchId shipmentId deviceId sensorId vehicleId sequenceNumber temperature humidity batteryLevel location source simulation recordedAt status evaluation")
      .sort(latest ? { recordedAt: -1, _id: -1 } : { recordedAt: 1, _id: 1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    let page = hasMore ? rows.slice(0, limit) : rows;
    if (latest) page = page.reverse();
    return res.json({ shipmentId, batchId: shipment.batchId, records: page.map(row => ({
      readingId: String(row._id), batchId: row.batchId, shipmentId: row.shipmentId,
      deviceId: row.deviceId || row.sensorId || null, vehicleId: row.vehicleId || null,
      sequenceNumber: row.sequenceNumber ?? row.simulation?.tick ?? null,
      temperature: row.temperature ?? null, humidity: row.humidity ?? null,
      batteryLevel: row.batteryLevel ?? null, location: row.location || null,
      source: row.source || row.simulation?.telemetrySource || "unknown",
      recordedAt: row.recordedAt,
      status: row.evaluation?.batchQuarantined ? "QUARANTINED" : row.evaluation?.severity || row.status || "unknown",
    })), hasMore, nextCursor: !latest && hasMore && page.length ? encodeHistoryCursor(page[page.length - 1]) : null });
  } catch (_) {
    return res.status(503).json({ error: "Shipment sensor history is temporarily unavailable" });
  }
};

exports.parseHistoryCursor = parseHistoryCursor;
exports.encodeHistoryCursor = encodeHistoryCursor;
