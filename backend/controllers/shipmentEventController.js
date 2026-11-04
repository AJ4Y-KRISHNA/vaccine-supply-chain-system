const mongoose = require("mongoose");
const Shipment = require("../models/Shipment");
const ColdChainAudit = require("../models/ColdChainAudit");

const EVENTS = new Set(["loading", "departed", "route update", "delivery attempted", "issue reported", "arrived"]);
exports.createShipmentEvent = async (req, res) => {
  try {
    const event = String(req.body.event || req.body.status || "").trim();
    const note = String(req.body.note || "").trim();
    if (!EVENTS.has(event.toLowerCase())) return res.status(400).json({ error: "Unsupported shipment event" });
    if (!note) return res.status(400).json({ error: "A note is required for shipment events" });
    const timestamp = req.body.timestamp ? new Date(req.body.timestamp) : new Date();
    if (!Number.isFinite(timestamp.getTime()) || timestamp > new Date()) return res.status(400).json({ error: "Shipment event timestamp must be valid and not in the future" });
    const identity = req.scope?.shipment || {};
    const ids = [{ shipmentId: req.params.id }];
    if (mongoose.isValidObjectId(req.params.id)) ids.push({ _id: req.params.id });
    const shipment = await Shipment.findOne({ $and: [identity, { $or: ids }] });
    if (!shipment) return res.status(404).json({ error: "Shipment not found in this user's scope" });
    const saved = { status: event, timestamp, source: "manual", enteredBy: String(req.user.id), note };
    shipment.statusHistory ||= [];
    shipment.statusHistory.push(saved);
    shipment.status = event;
    shipment.lastUpdatedAt = timestamp;
    await shipment.save();
    if (shipment.batchId) await ColdChainAudit.create({ batchId: shipment.batchId, correlationId: req.correlationId,
      action: "Manual shipment event recorded", actorId: String(req.user.id), reason: note, eventTime: timestamp,
      snapshot: { source: "manual", enteredBy: String(req.user.id), shipmentId: shipment.shipmentId, event } });
    return res.status(201).json({ shipmentId: shipment.shipmentId, event: saved });
  } catch (error) { return res.status(500).json({ error: "Unable to record shipment event" }); }
};
