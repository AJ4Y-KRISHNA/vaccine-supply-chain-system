jest.mock("../services/emailOutbox", () => ({ enqueueForNotification: jest.fn() }));
const db = require("./helpers/coldChainFixture");
const Notification = require("../models/Notification");
const emailOutbox = require("../services/emailOutbox");
const { notify } = require("../services/coldChainActions");

beforeAll(db.connect);
afterAll(db.close);
beforeEach(async () => {
  await Notification.deleteMany({});
  jest.clearAllMocks();
});

test("cold-chain notice queues email independently and preserves all in-app role notifications on email outage", async () => {
  const f = await db.fixture();
  emailOutbox.enqueueForNotification.mockRejectedValueOnce(new Error("outbox temporarily unavailable"));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const alert = {
    alertId: `ALERT-${f.batchId}`, batchId: f.batchId, shipmentId: f.shipmentId,
    correlationId: "trace.notice-13",
    reason: "Synthetic high temperature", metric: "TEMPERATURE", breachedLimit: 8,
    currentTemperature: 10, currentHumidity: 60, excursionDurationMs: 120000,
    recommendedAction: "Quarantine and request quality review", context: { source: "software-iot-simulator" },
    notificationTargets: [], save: jest.fn().mockResolvedValue(undefined),
  };
  await expect(notify(alert, "QUARANTINED")).resolves.toBeUndefined();
  const notices = await Notification.find({ alertId: alert.alertId }).lean();
  expect(notices.map(item => item.recipientRole).sort()).toEqual(["admin", "distributor", "healthcare", "manufacturer"]);
  expect(notices.every(item => item.correlationId === "trace.notice-13" && item.metadata?.correlationId === "trace.notice-13")).toBe(true);
  expect(emailOutbox.enqueueForNotification).toHaveBeenCalledTimes(2);
  expect(emailOutbox.enqueueForNotification.mock.calls.map(([notice]) => notice.recipientRole).sort()).toEqual(["admin", "manufacturer"]);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("in-app notification was saved:"), "outbox temporarily unavailable");
  expect(alert.save).toHaveBeenCalledTimes(1);
  log.mockRestore();
});
