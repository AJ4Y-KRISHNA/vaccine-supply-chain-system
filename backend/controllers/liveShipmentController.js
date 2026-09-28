const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const TemperatureLog = require("../models/TemperatureLog");
const ColdChainPolicy = require("../models/ColdChainPolicy");

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
