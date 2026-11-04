const { normalizeOrCreateCorrelationId, runWithCorrelationId } = require("../services/correlationContext");
const logger = require("../services/structuredLogger");

module.exports = function correlationId(req, res, next) {
  const id = normalizeOrCreateCorrelationId(req.get("x-correlation-id"));
  req.correlationId = id;
  res.setHeader("X-Correlation-ID", id);
  runWithCorrelationId(id, () => {
    const startedAt = Date.now();
    res.once("finish", () => logger.info("http.request.completed", {
      correlationId: id,
      method: req.method,
      path: req.route?.path ? `${req.baseUrl || ""}${req.route.path}` : req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    }));
    next();
  });
};
