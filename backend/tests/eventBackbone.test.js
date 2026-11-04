const backbone = require("../services/eventBackbone");
function fakeRedis(message, retry = null) {
  const tx = { xAck: jest.fn().mockReturnThis(), hDel: jest.fn().mockReturnThis(),
    xAdd: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) };
  return { xReadGroup: jest.fn().mockResolvedValue([{ messages: [message] }]),
    hGet: jest.fn().mockResolvedValue(retry ? JSON.stringify(retry) : null),
    hSet: jest.fn().mockResolvedValue(1), multi: jest.fn(() => tx), tx };
}
const event = { eventId: "synthetic-event", correlationId: "trace-1", reading: {} };
const message = { id: "1-0", message: { event: JSON.stringify(event) } };
test("stable event identity uses device sequence, not correlation or reading time", () => {
  const first = backbone.envelope({ deviceId: "D1", sequenceNumber: 4, correlationId: "a", temperature: 5 });
  const retry = backbone.envelope({ deviceId: "D1", sequenceNumber: 4, correlationId: "b", temperature: 6 });
  expect(first.eventId).toBe(retry.eventId);
  expect(first.reading._id).toBe(retry.reading._id);
  expect(first.synthetic).toBe(true);
  expect(backbone.groups).toEqual(["persistence", "policy-alert", "ai-advisory", "anchoring"]);
});
test("successful consumer acknowledges only after handler completes", async () => {
  const redis = fakeRedis(message);
  await backbone.consumeOnce("persistence", async e => {
    expect(e.correlationId).toBe("trace-1"); expect(redis.tx.xAck).not.toHaveBeenCalled();
  }, redis);
  expect(redis.tx.xAck).toHaveBeenCalledWith(backbone.stream(), "persistence", "1-0");
});
test("failure schedules backoff without acknowledgement", async () => {
  const redis = fakeRedis(message);
  await backbone.consumeOnce("ai-advisory", async () => { throw new Error("offline"); }, redis, 1000);
  expect(JSON.parse(redis.hSet.mock.calls[0][2])).toEqual({ attempt: 1, nextAt: 1500 });
  expect(redis.tx.xAck).not.toHaveBeenCalled();
  expect(backbone.backoff(50)).toBe(30000);
});
test("not-yet-due retries do not call an external service", async () => {
  const redis = fakeRedis(message, { attempt: 2, nextAt: 2000 }), handler = jest.fn();
  expect(await backbone.consumeOnce("anchoring", handler, redis, 1000)).toBe(false);
  expect(handler).not.toHaveBeenCalled();
});
test("dependency wait does not consume external retry budget", async () => {
  const redis = fakeRedis(message);
  await backbone.consumeOnce("policy-alert", async () => { throw Object.assign(new Error("pending"), { dependencyPending: true }); }, redis, 1000);
  expect(JSON.parse(redis.hSet.mock.calls[0][2])).toEqual({ attempt: 0, nextAt: 1250 });
});
test("exhaustion atomically dead-letters and acknowledges", async () => {
  const redis = fakeRedis(message, { attempt: 19, nextAt: 0 });
  await backbone.consumeOnce("anchoring", async () => { throw new Error("chain offline"); }, redis, 1000);
  expect(redis.tx.xAdd).toHaveBeenCalledWith(`${backbone.prefix()}:dead-letter:anchoring`, "*", expect.objectContaining({ correlationId: "trace-1", attempt: "20" }));
  expect(redis.tx.xAck).toHaveBeenCalled();
});
