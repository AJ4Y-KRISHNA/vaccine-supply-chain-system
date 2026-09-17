const jwt = require("jsonwebtoken");
const User = require("../models/user");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Alert = require("../models/TemperatureAlert");
const { withBatchLock } = require("../services/coldChainLock");
// Safety actions always require a signed identity, including when AUTH_OPTIONAL
// is enabled elsewhere. Roles/capabilities come from the current database record.
async function requireIdentity(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    const user = await User.findById(payload.id).lean();
    if (!user) return res.status(401).json({ error: "Account not found" });
    req.user = { ...user, id: String(user._id), role: String(user.role).toLowerCase() };
    next();
  } catch (_) { res.status(401).json({ error: "Invalid or expired credentials" }); }
}

function protectOperation(roles, controller, { allowNewBatch = false, newBatchOnly = false } = {}) {
  return async (req, res) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: "Role cannot perform this operation" });
    try {
      // Do not permit callers to set policy, quarantine or ownership bypass fields
      // via older controllers that spread req.body into database documents.
      for (const key of Object.keys(req.body || {})) {
        if (/^(coldChain|temperaturePolicy|canReviewColdChain)/i.test(key)) return res.status(400).json({ error: "Protected cold-chain fields cannot be supplied here" });
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
        if (batch && newBatchOnly) return res.status(409).json({ error: "Batch ID already exists" });
        const heldShipment = await Shipment.exists({ batchId, "coldChainHoldAlertIds.0": { $exists: true } });
        const heldAlert = await Alert.exists({ batchId, requiresQualityReview: true });
        if (batch?.coldChainHoldAlertIds?.length || heldShipment || heldAlert) return res.status(409).json({ error: "Quarantined—pending quality review", code: "COLD_CHAIN_HOLD" });
        if (batch?.coldChainPolicyId && (req.body.vaccineType && req.body.vaccineType !== batch.vaccineType || req.body.manufacturer && req.body.manufacturer !== batch.manufacturer)) return res.status(409).json({ error: "An approved policy is bound to this batch's vaccine and manufacturer; create a separate batch for a different product/owner" });
        if (req.user.role === "manufacturer" && batch) {
          const keys = [req.user.email, req.user.manufacturer].filter(Boolean).map(v => v.trim().toLowerCase());
          if (!keys.includes(String(batch.manufacturer || "").trim().toLowerCase())) return res.status(403).json({ error: "Batch belongs to a different manufacturer" });
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
      const keys = [req.user.email, req.user.manufacturer].filter(Boolean).map(v => v.trim().toLowerCase());
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
