jest.mock("../models/NotificationOutbox", () => ({ updateOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock("../models/TemperatureAlert", () => ({ hydrate: jest.fn(x => x) }));
jest.mock("../services/coldChainActions", () => ({ notify: jest.fn() }));
jest.mock("../services/eventBackbone", () => ({ prefix: () => "synthetic:test", backoff: () => 500,
  connection: jest.fn().mockResolvedValue({ xAdd: jest.fn() }) }));
const Outbox = require("../models/NotificationOutbox");
const actions = require("../services/coldChainActions");
const dispatcher = require("../services/notificationDispatcher");
beforeEach(() => jest.clearAllMocks());
test("enqueue deduplicates by committed alert transition and carries correlation", async () => {
  const snapshot = { alertId: "A", correlationId: "trace-4", reason: "Synthetic excursion" };
  await dispatcher.enqueue({ ...snapshot, toObject: () => snapshot }, "QUARANTINED");
  expect(Outbox.updateOne).toHaveBeenCalledWith({ deduplicationKey: "A:QUARANTINED" },
    { $setOnInsert: expect.objectContaining({ snapshot, correlationId: "trace-4" }) }, { upsert: true });
});
test("dispatcher uses snapshot and marks sent only after fanout", async () => {
  const row = { snapshot: { alertId: "A", reason: "original excursion" }, stage: "QUARANTINED", attempts: 1,
    correlationId: "trace-4", save: jest.fn() };
  Outbox.findOneAndUpdate.mockResolvedValue(row); actions.notify.mockResolvedValue();
  await dispatcher.processOnce();
  expect(actions.notify).toHaveBeenCalledWith(row.snapshot, row.stage, { dispatch: true });
  expect(row.status).toBe("sent"); expect(row.save).toHaveBeenCalled();
});
test("fanout failure retries the same row with backoff", async () => {
  const row = { snapshot: {}, stage: "REVIEW_REQUIRED", attempts: 1, save: jest.fn() };
  Outbox.findOneAndUpdate.mockResolvedValue(row); actions.notify.mockRejectedValue(new Error("database unavailable"));
  await dispatcher.processOnce();
  expect(row.status).toBe("queued"); expect(row.nextAttemptAt).toBeInstanceOf(Date);
  expect(row.lastError).toBe("database unavailable");
});

test("exhausted fanout records a dead-letter reference and terminal Mongo status", async () => {
  const row = { _id: "synthetic-outbox-id", snapshot: {}, stage: "QUARANTINED", attempts: 20,
    correlationId: "trace-dlq", save: jest.fn() };
  Outbox.findOneAndUpdate.mockResolvedValue(row); actions.notify.mockRejectedValue(new Error("fanout unavailable"));
  await dispatcher.processOnce();
  const redis = await require("../services/eventBackbone").connection();
  expect(redis.xAdd).toHaveBeenCalledWith("synthetic:test:dead-letter:outbox", "*", expect.objectContaining({ outboxId: "synthetic-outbox-id", correlationId: "trace-dlq" }));
  expect(row.status).toBe("dead-letter");
});
