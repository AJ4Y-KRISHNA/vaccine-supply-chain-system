jest.mock("../services/structuredLogger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const correlationMiddleware = require("../middleware/correlationId");
const logger = require("../services/structuredLogger");
const { getCorrelationId, normalizeOrCreateCorrelationId, runWithCorrelationId } = require("../services/correlationContext");

function response() {
  const listeners = new Map();
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    once(name, callback) { listeners.set(name, callback); },
    finish() { listeners.get("finish")?.(); },
    statusCode: 200,
  };
}

test("passes a valid incoming ID through the request context, response header, and structured log", () => {
  const req = { get: () => "demo.trace-42", method: "GET", path: "/health" };
  const res = response();
  const next = jest.fn();
  correlationMiddleware(req, res, next);

  expect(req.correlationId).toBe("demo.trace-42");
  expect(res.headers["X-Correlation-ID"]).toBe("demo.trace-42");
  expect(next).toHaveBeenCalled();
  res.finish();
  expect(logger.info).toHaveBeenCalledWith("http.request.completed", expect.objectContaining({
    correlationId: "demo.trace-42", method: "GET", path: "/health", statusCode: 200,
  }));
});

test("replaces malformed or oversized external IDs with a bounded UUID", () => {
  const req = { get: () => "bad id" };
  const res = response();
  correlationMiddleware(req, res, jest.fn());
  expect(req.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(res.headers["X-Correlation-ID"]).toBe(req.correlationId);
  expect(normalizeOrCreateCorrelationId("x".repeat(129))).toMatch(/^[0-9a-f-]{36}$/i);
});

test("correlation context follows async work and does not leak to the next request", async () => {
  await runWithCorrelationId("trace.async-9", async () => {
    await Promise.resolve();
    expect(getCorrelationId()).toBe("trace.async-9");
  });
  expect(getCorrelationId()).toBeNull();
});
