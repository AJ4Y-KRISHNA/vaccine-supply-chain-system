const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");

const storage = new AsyncLocalStorage();
const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function normalizeOrCreateCorrelationId(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return SAFE_CORRELATION_ID.test(candidate) ? candidate : randomUUID();
}

function getCorrelationId() { return storage.getStore()?.correlationId || null; }

function runWithCorrelationId(correlationId, operation) {
  return storage.run({ correlationId: normalizeOrCreateCorrelationId(correlationId) }, operation);
}

module.exports = { normalizeOrCreateCorrelationId, getCorrelationId, runWithCorrelationId };
