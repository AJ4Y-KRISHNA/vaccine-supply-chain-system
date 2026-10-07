const LocationHistory = require("../models/LocationHistory");

exports.listBatchLocationHistory = async (req, res) => {
  const parsedLimit = req.query.limit === undefined ? 500 : Number(req.query.limit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
    return res.status(400).json({ error: "Limit must be a whole number from 1 to 1000" });
  }

  try {
    const points = await LocationHistory.find({ $and: [req.scope.relatedBatch, { batchId: req.params.batchId }] })
      .sort({ recordedAt: 1, sequenceNumber: 1, _id: 1 }).limit(parsedLimit).lean();
    return res.json({ batchId: req.params.batchId, points, total: points.length, limit: parsedLimit });
  } catch (_error) {
    return res.status(503).json({ error: "Location history is temporarily unavailable" });
  }
};
