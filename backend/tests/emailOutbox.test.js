jest.mock("../services/emailTransport", () => ({ send: jest.fn() }));
const db = require("./helpers/coldChainFixture");
const User = require("../models/user");
const Notification = require("../models/Notification");
const EmailDelivery = require("../models/EmailDelivery");
const transport = require("../services/emailTransport");
const emailOutbox = require("../services/emailOutbox");

beforeAll(db.connect);
afterAll(db.close);
beforeEach(async () => {
  await Promise.all([EmailDelivery.deleteMany({}), Notification.deleteMany({}), User.deleteMany({})]);
  jest.clearAllMocks();
  process.env.ALERT_EMAIL_ENABLED = "true";
  process.env.ALERT_EMAIL_MAX_ATTEMPTS = "2";
  process.env.ALERT_EMAIL_RETRY_BASE_MS = "1000";
});
afterAll(() => {
  delete process.env.ALERT_EMAIL_ENABLED;
  delete process.env.ALERT_EMAIL_MAX_ATTEMPTS;
  delete process.env.ALERT_EMAIL_RETRY_BASE_MS;
});

async function notification(f, recipientRole = "admin", recipientRefKey = "") {
  return Notification.create({ recipientRole, recipientRefKey, recipientRef: recipientRefKey,
    deduplicationKey: `ALERT-${f.batchId}:QUARANTINED:${recipientRole}:${recipientRefKey}`, alertId: `ALERT-${f.batchId}`,
    correlationId: "trace.email-17",
    auditBatchId: f.batchId, title: "Application Notification: QUARANTINED", message: "Synthetic out-of-range reading",
    metadata: { stage: "QUARANTINED", deepLink: `/admin?batchId=${f.batchId}` } });
}

test("queues deduplicated individual admin and owning-manufacturer email deliveries", async () => {
  const f = await db.fixture();
  await User.create([
    { email: `second-admin-${f.batchId}@example.test`, role: "admin" },
    { email: `owner-${f.batchId}@example.test`, role: "manufacturer", manufacturer: "MAKER-A" },
    { email: `alias-${f.batchId}@example.test`, role: "manufacturer", organizationAliases: ["maker-a"] },
    { email: `other-maker-${f.batchId}@example.test`, role: "manufacturer", manufacturer: "maker-b" },
    { email: `disabled-${f.batchId}@example.test`, role: "admin", disabled: true },
  ]);
  const adminNotice = await notification(f);
  const makerNotice = await notification(f, "manufacturer", "maker-a");
  expect(await emailOutbox.enqueueForNotification(adminNotice)).toMatchObject({ queued: 2, recipients: 2 });
  expect(await emailOutbox.enqueueForNotification(makerNotice)).toMatchObject({ queued: 2, recipients: 2 });
  expect(await emailOutbox.enqueueForNotification(adminNotice)).toMatchObject({ queued: 0, recipients: 2 });
  expect(await EmailDelivery.countDocuments()).toBe(4);
  const queued = await EmailDelivery.find().lean();
  expect(queued.every(item => item.status === "queued" && item.attempts === 0)).toBe(true);
  expect(queued.every(item => item.correlationId === "trace.email-17")).toBe(true);
  expect(queued.map(item => item.recipientEmail)).not.toContain(`other-maker-${f.batchId}@example.test`);
  expect(queued.map(item => item.recipientEmail)).not.toContain(`disabled-${f.batchId}@example.test`);

  transport.send.mockResolvedValue({ providerMessageId: "provider-demo-id", previewUrl: "https://ethereal.email/message/synthetic-preview",
    simulated: true, transportMode: "ethereal" });
  expect(await emailOutbox.processOnce(10)).toEqual({ sent: 4, failed: 0 });
  expect(await EmailDelivery.countDocuments({ status: "sent", attempts: 1, providerMessageId: "provider-demo-id" })).toBe(4);
  expect((await Notification.findById(adminNotice._id).lean()).emailPreviewLinks).toEqual([
    expect.objectContaining({ url: "https://ethereal.email/message/synthetic-preview", transportMode: "ethereal" }),
  ]);
});

test("records provider errors and automatically retries with bounded backoff", async () => {
  const f = await db.fixture();
  const user = f.reviewer;
  const notice = await notification(f);
  await emailOutbox.enqueueForNotification(notice);
  transport.send.mockRejectedValueOnce(new Error("temporary provider outage"))
    .mockResolvedValueOnce({ providerMessageId: "recovered" });
  const start = new Date(Date.now() + 1000);
  expect(await emailOutbox.processOnce(10, start)).toEqual({ sent: 0, failed: 1 });
  let delivery = await EmailDelivery.findOne({ recipientUserId: user._id }).lean();
  expect(delivery).toMatchObject({ status: "failed", attempts: 1, maxAttempts: 2, lastError: "temporary provider outage" });
  expect(delivery.nextAttemptAt.getTime()).toBe(start.getTime() + 1000);
  expect(await emailOutbox.processOnce(10, new Date(start.getTime() + 999))).toEqual({ sent: 0, failed: 0 });
  expect(await emailOutbox.processOnce(10, new Date(start.getTime() + 1001))).toEqual({ sent: 1, failed: 0 });
  delivery = await EmailDelivery.findOne({ recipientUserId: user._id }).lean();
  expect(delivery).toMatchObject({ status: "sent", attempts: 2, providerMessageId: "recovered" });
  expect(delivery).not.toHaveProperty("lastError");
});

test("assigned distributor and healthcare emails exclude unrelated organizations", async () => {
  const f = await db.fixture();
  await User.create([
    { role: "distributor", email: "assigned-dist@synthetic.test", distributor: "dist-a" },
    { role: "distributor", email: "other-dist@synthetic.test", distributor: "dist-b" },
    { role: "healthcare", email: "assigned-hospital@synthetic.test", hospital: "hospital-a" },
    { role: "healthcare", email: "other-hospital@synthetic.test", hospital: "hospital-b" },
  ]);
  expect(await emailOutbox.enqueueForNotification(await notification(f, "distributor", "dist-a"))).toMatchObject({ queued: 1 });
  expect(await emailOutbox.enqueueForNotification(await notification(f, "healthcare", "hospital-a"))).toMatchObject({ queued: 1 });
  expect((await EmailDelivery.distinct("recipientEmail")).sort()).toEqual(["assigned-dist@synthetic.test", "assigned-hospital@synthetic.test"]);
});

test("does not queue or attempt delivery while email is disabled", async () => {
  const f = await db.fixture();
  const notice = await notification(f);
  process.env.ALERT_EMAIL_ENABLED = "false";
  expect(await emailOutbox.enqueueForNotification(notice)).toEqual({ queued: 0, disabled: true });
  expect(await emailOutbox.processOnce()).toEqual({ disabled: true, sent: 0, failed: 0 });
  expect(transport.send).not.toHaveBeenCalled();
  expect(await EmailDelivery.countDocuments()).toBe(0);
});

test("closes a stale delivery left sending after its final allowed attempt", async () => {
  const f = await db.fixture();
  const notice = await notification(f);
  await emailOutbox.enqueueForNotification(notice);
  const start = new Date();
  await EmailDelivery.updateOne({ recipientUserId: f.reviewer._id }, { $set: {
    status: "sending", attempts: 2, maxAttempts: 2, lockedAt: new Date(start.getTime() - 6 * 60 * 1000),
  } });
  expect(await emailOutbox.processOnce(10, start)).toEqual({ sent: 0, failed: 0 });
  const delivery = await EmailDelivery.findOne({ recipientUserId: f.reviewer._id }).lean();
  expect(delivery).toMatchObject({ status: "failed", attempts: 2,
    lastError: "Delivery worker stopped during the final allowed attempt; automatic retries are exhausted." });
  expect(delivery).not.toHaveProperty("nextAttemptAt");
  expect(transport.send).not.toHaveBeenCalled();
});
