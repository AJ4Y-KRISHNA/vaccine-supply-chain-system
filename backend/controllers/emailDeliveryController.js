const EmailDelivery = require("../models/EmailDelivery");

async function listEmailDeliveries(req, res) {
  const allowedStatuses = new Set(["queued", "sending", "sent", "failed"]);
  const status = req.query.status;
  if (status && !allowedStatuses.has(status)) return res.status(400).json({ error: "Invalid email delivery status" });
  const parsedLimit = Number(req.query.limit || 50);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) return res.status(400).json({ error: "Limit must be an integer from 1 to 100" });
  const query = status ? { status } : {};
  try {
    const [deliveries, total] = await Promise.all([
      EmailDelivery.find(query).select("recipientRole recipientEmail alertId batchId status attempts maxAttempts transportMode simulated nextAttemptAt sentAt lastError createdAt updatedAt")
        .sort({ createdAt: -1, _id: -1 }).limit(parsedLimit).lean(),
      EmailDelivery.countDocuments(query),
    ]);
    return res.json({ deliveries, total, limit: parsedLimit });
  } catch (_) { return res.status(503).json({ error: "Email delivery records are unavailable" }); }
}

module.exports = { listEmailDeliveries };
