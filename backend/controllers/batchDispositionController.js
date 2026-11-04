const { setBatchDisposition } = require("../services/batchDispositionService");

exports.updateBatchDisposition = async (req, res) => {
  try {
    const result = await setBatchDisposition(req.params.batchId, req.body, req.user);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message, code: error.code || "DISPOSITION_UPDATE_FAILED" });
  }
};
