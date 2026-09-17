const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const normalize = value => String(value || "").trim().toLowerCase();
const identityKeys = user => [...new Set([user.email, user[user.role === "healthcare" ? "hospital" : user.role], ...(user.organizationAliases || [])].map(normalize).filter(Boolean))];
const ownsIdentity = (user, value) => identityKeys(user).includes(normalize(value));
const identityPatterns = user => identityKeys(user).map(key => new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"));
async function scopeData(req, res, next) {
  try {
    if (req.user.role === "admin") {
      req.scope = { batch: {}, shipment: {}, telemetry: {}, vaccination: {}, order: {}, distribution: {}, relatedBatch: {} };
      return next();
    }
    const patterns = identityPatterns(req.user);
    const ownerFilter = req.user.role === "manufacturer" ? { manufacturer: { $in: patterns } } : null;
    const batches = ownerFilter ? await Batch.find(ownerFilter).select("batchId").lean() : [];
    const shipment = ownerFilter ? { batchId: { $in: batches.map(b => b.batchId) } }
      : { [req.user.role === "distributor" ? "distributor" : "destination"]: { $in: patterns } };
    const shipments = await Shipment.find(shipment).select("shipmentId batchId destination").lean();
    const batchIds = [...new Set([...batches.map(b => b.batchId), ...shipments.map(s => s.batchId)])];
    const relatedBatch = { batchId: { $in: batchIds } };
    req.scope = { batch: ownerFilter || relatedBatch, shipment, relatedBatch,
      telemetry: ownerFilter ? relatedBatch : { $or: [{ shipmentId: { $in: shipments.map(s => s.shipmentId) } },
        { ...relatedBatch, $or: [{ shipmentId: { $exists: false } }, { shipmentId: "" }] }] },
      vaccination: { $or: [{ hospital: { $in: patterns } }, { centerId: { $in: patterns } }] },
      order: req.user.role === "healthcare" ? { $or: [{ hospital: { $in: patterns } }, { centerId: { $in: patterns } }] }
        : req.user.role === "distributor" ? { distributor: { $in: patterns } } : { allocatedBatchId: { $in: batchIds } },
      distribution: req.user.role === "manufacturer" ? relatedBatch : { ...relatedBatch, targetCenter: { $in: shipments.map(s => s.destination) } },
    };
    next();
  } catch (error) { res.status(503).json({ error: "Unable to establish organization scope" }); }
}
function bindOrganization(req, res, next) {
  if (req.user.role === "admin") return next();
  req.body ||= {};
  const fields = req.user.role === "healthcare" ? ["hospital", "centerId", "healthcareCenter"] : req.user.role === "manufacturer" ? ["manufacturer"] : ["distributor"];
  for (const field of fields) {
    if (req.body[field] && !ownsIdentity(req.user, req.body[field])) return res.status(403).json({ error: "Organization identity cannot be overridden" });
    req.body[field] ||= req.user[req.user.role === "healthcare" ? "hospital" : req.user.role] || req.user.email;
  }
  req.body.submittedBy = req.user.email;
  next();
}
async function batchRead(req, res, next) {
  if (req.user.role === "admin") return next();
  if (!await Batch.exists({ $and: [req.scope.batch, { batchId: req.params.batchId }] })) return res.status(404).json({ error: "Batch not found" });
  next();
}
module.exports = { identityKeys, identityPatterns, ownsIdentity, scopeData, bindOrganization, batchRead };
