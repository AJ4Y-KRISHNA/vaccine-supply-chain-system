const { authenticate: requireIdentity } = require("./auth");
const { identityKeys, identityPatterns, ownsIdentity } = require("./identityScope");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Alert = require("../models/TemperatureAlert");
const { withBatchLock } = require("../services/coldChainLock");
// Safety actions always require a signed identity, including when AUTH_OPTIONAL
// is enabled elsewhere. Roles/capabilities come from the current database record.

function protectOperation(roles, controller, { allowNewBatch = false, newBatchOnly = false, createsShipment = false } = {}) {
  return async (req, res) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: "Role cannot perform this operation" });
    try {
      // Do not permit callers to set policy, quarantine or ownership bypass fields
      // via older controllers that spread req.body into database documents.
      for (const key of Object.keys(req.body || {})) {
        if (/^(coldChain|temperaturePolicy|canReviewColdChain|isDemo|demoProvenance|organizationAliases|tokenVersion|disabled)/i.test(key) || ["productionApproved", "labApproved", "releaseVisibleToExternal", "releaseApprovedAt"].includes(key)) return res.status(400).json({ error: "Protected fields cannot be supplied here" });
      }
      req.body = req.body || {};
      const shipmentId = req.params.shipmentId || req.body.shipmentId;
      if (shipmentId && typeof shipmentId !== "string" || req.body.batchId && typeof req.body.batchId !== "string") return res.status(400).json({ error: "Batch and shipment identifiers must be strings" });
      const shipment = shipmentId ? await Shipment.findOne({ shipmentId }).lean() : null;
      if (req.params.shipmentId && !shipment) return res.status(404).json({ error: "Shipment not found" });
      if (shipment && req.body?.batchId && shipment.batchId !== req.body.batchId) return res.status(400).json({ error: "Shipment and batch do not match" });
      if (req.params.batchId && (req.body.batchId && req.body.batchId !== req.params.batchId || shipment && shipment.batchId !== req.params.batchId)) return res.status(400).json({ error: "Conflicting batch identifiers" });
      const batchId = req.params.batchId || shipment?.batchId || req.body.batchId;
      if (!batchId) return res.status(400).json({ error: "A batchId or existing shipmentId is required for traceable operations" });
      return await withBatchLock(batchId, async () => {
        const batch = await Batch.findOne({ batchId }).lean();
        if (!batch && !allowNewBatch) return res.status(404).json({ error: "Batch not found" });
        const heldShipment = await Shipment.exists({ batchId, "coldChainHoldAlertIds.0": { $exists: true } });
        const heldAlert = await Alert.exists({ batchId, requiresQualityReview: true });
        if (batch?.coldChainHoldAlertIds?.length || heldShipment || heldAlert) return res.status(409).json({ error: "Quarantined—pending quality review", code: "COLD_CHAIN_HOLD" });
        if (batch && newBatchOnly) return res.status(409).json({ error: "Batch ID already exists" });
        if (batch?.expiresAt && +new Date(batch.expiresAt) <= Date.now()) return res.status(409).json({ error: "Batch has expired", code: "BATCH_EXPIRED" });
        if (createsShipment) {
          if (shipment) return res.status(409).json({ error: "Shipment identifier already exists" });
          const { inventorySnapshot, isDoseCount } = require("../services/inventoryEligibility");
          if (!isDoseCount(req.body.quantity)) return res.status(400).json({ error: "Shipment quantity must be a nonnegative whole number" });
          if (req.body.quantity > 0) {
            const item = (await inventorySnapshot()).find(item => item.batchId === batchId);
            if (!item?.eligible || item.remainingDoses < req.body.quantity) return res.status(409).json({ error: "Insufficient eligible unassigned batch stock" });
          }
        }
        if (batch?.coldChainPolicyId && (req.body.vaccineType && req.body.vaccineType !== batch.vaccineType || req.body.manufacturer && req.body.manufacturer !== batch.manufacturer)) return res.status(409).json({ error: "An approved policy is bound to this batch's vaccine and manufacturer; create a separate batch for a different product/owner" });
        if (req.user.role === "manufacturer" && batch) {
          const keys = identityKeys(req.user);
          if (!keys.includes(String(batch.manufacturer || "").trim().toLowerCase())) return res.status(403).json({ error: "Batch belongs to a different manufacturer" });
        }
        if (req.user.role === "manufacturer") {
          if (req.body.manufacturer && !ownsIdentity(req.user, req.body.manufacturer)) return res.status(403).json({ error: "Manufacturer identity cannot be overridden" });
          if (!batch) req.body.manufacturer = req.user.manufacturer || req.user.email;
        }
        if (["distributor", "healthcare"].includes(req.user.role)) {
          const field = req.user.role === "distributor" ? "distributor" : "destination";
          const associated = shipment || await Shipment.findOne({ batchId, [field]: { $in: identityPatterns(req.user) } }).lean();
          const newShipment = req.user.role === "distributor" && !shipment && !req.params.shipmentId && req.method === "POST";
          if (shipment && !ownsIdentity(req.user, shipment[field]) || !associated && !newShipment) return res.status(403).json({ error: "Shipment is not assigned to this organization" });
          if (newShipment && !batch?.releaseVisibleToExternal) return res.status(409).json({ error: "Batch is not released for shipment" });
          const bodyFields = req.user.role === "healthcare" ? ["hospital", "centerId"] : ["distributor"];
          for (const field of bodyFields) {
            if (req.body[field] && !ownsIdentity(req.user, req.body[field])) return res.status(403).json({ error: "Organization identity cannot be overridden" });
            if (!req.body[field]) req.body[field] = req.user[req.user.role === "healthcare" ? "hospital" : "distributor"] || req.user.email;
          }
          if (shipment && req.body.destination && req.body.destination !== shipment.destination) return res.status(403).json({ error: "Reassignment requires an admin" });
          if (shipment && req.body.quantity !== undefined && req.body.quantity !== shipment.quantity) return res.status(403).json({ error: "Quantity amendment requires an admin" });
          if (req.user.role === "healthcare") req.body.confirmedBy = req.user.id;
        }
        if (!req.body.batchId) req.body.batchId = batchId;
        return controller(req, res);
      });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  };
}

async function authorizeSimulator(req, res, next) {
  if (!["admin", "manufacturer"].includes(req.user.role)) return res.status(403).json({ error: "Simulator controls require admin or manufacturer role" });
  try {
    if (req.method === "GET" && !req.params.deviceId) return next();
    const config = req.params.deviceId
      ? require("../controllers/simulatorController").simulatorManager.getStatus(req.params.deviceId) : req.body;
    if (!config || typeof config.batchId !== "string" && config.batchId !== undefined) return res.status(400).json({ error: "Invalid batch identifier" });
    if (!config.batchId) {
      if (req.user.role !== "admin" || config.shipmentId) return res.status(400).json({ error: "Select an existing batch for this device" });
      return next();
    }
    const batch = await Batch.findOne({ batchId: config.batchId }).lean();
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (req.user.role === "manufacturer") {
      const keys = identityKeys(req.user);
      if (!keys.includes(String(batch.manufacturer || "").trim().toLowerCase())) return res.status(403).json({ error: "Device batch belongs to another manufacturer" });
    }
    if (config.shipmentId) {
      if (typeof config.shipmentId !== "string") return res.status(400).json({ error: "Invalid shipment identifier" });
      const shipment = await Shipment.findOne({ shipmentId: config.shipmentId }).lean();
      if (!shipment || shipment.batchId !== batch.batchId) return res.status(400).json({ error: "Select a shipment belonging to this batch" });
    }
    next();
  } catch (error) { res.status(error.name === "SimulationNotFoundError" ? 404 : 500).json({ error: error.message }); }
}
module.exports = { requireIdentity, protectOperation, authorizeSimulator };
