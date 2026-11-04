const { getCorrelationId } = require("./correlationContext");

function write(level, event, fields = {}) {
  if (process.env.NODE_ENV === "test" && process.env.STRUCTURED_LOG_TEST_OUTPUT !== "true") return;
  const correlationId = fields.correlationId || getCorrelationId();
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: "vaccine-supply-chain-backend",
    event,
    ...fields,
    ...(correlationId ? { correlationId } : {}),
  };
  const output = JSON.stringify(entry);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.info(output);
}

module.exports = {
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields),
};
