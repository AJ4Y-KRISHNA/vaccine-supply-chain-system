const express = require("express");
const request = require("supertest");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const User = require("../models/user");
const Notification = require("../models/Notification");
const EmailDelivery = require("../models/EmailDelivery");
const { issueToken } = require("../middleware/auth");

const app = express();
app.use("/api/admin", require("../routes/adminRoutes"));
const bearer = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });

beforeAll(connect);
afterAll(close);
beforeEach(async () => {
  await Promise.all([EmailDelivery.deleteMany({}), Notification.deleteMany({})]);
});

test("admin can inspect delivery status and safe errors; another role is denied", async () => {
  const f = await fixture();
  const [admin, maker] = await User.create([
    { email: `email-admin-${f.batchId}@example.test`, role: "admin" },
    { email: `email-maker-${f.batchId}@example.test`, role: "manufacturer", manufacturer: "maker-a" },
  ]);
  const notice = await Notification.create({ recipientRole: "admin", deduplicationKey: `notice-${f.batchId}`, title: "Alert", message: "Synthetic" });
  await EmailDelivery.create({ deduplicationKey: `delivery-${f.batchId}`, notificationId: notice._id,
    recipientUserId: admin._id, recipientRole: "admin", recipientEmail: admin.email, alertId: `ALERT-${f.batchId}`,
    batchId: f.batchId, subject: "Synthetic alert", text: "Do not expose full message through status API", status: "failed",
    attempts: 2, maxAttempts: 5, nextAttemptAt: new Date(), lastError: "Email provider rejected delivery (503)" });
  const response = await request(app).get("/api/admin/email-deliveries?status=failed").set(bearer(admin));
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ total: 1, deliveries: [expect.objectContaining({
    recipientEmail: admin.email, recipientRole: "admin", batchId: f.batchId, status: "failed", attempts: 2, maxAttempts: 5,
  })] });
  expect(response.body.deliveries[0]).not.toHaveProperty("text");
  expect(response.body.deliveries[0]).not.toHaveProperty("subject");
  expect((await request(app).get("/api/admin/email-deliveries").set(bearer(maker))).status).toBe(403);
  expect((await request(app).get("/api/admin/email-deliveries?status=unknown").set(bearer(admin))).status).toBe(400);
  expect((await request(app).get("/api/admin/email-deliveries")).status).toBe(401);
});
