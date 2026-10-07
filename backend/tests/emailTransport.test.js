const mockSendMail = jest.fn().mockResolvedValue({ messageId: "ethereal-message-id", accepted: ["admin@example.test"] });
const mockCreateTestAccount = jest.fn().mockResolvedValue({
  user: "ethereal-user@example.test", pass: "ethereal-test-password",
  smtp: { host: "smtp.ethereal.email", port: 587, secure: false },
});
const mockGetTestMessageUrl = jest.fn(() => "https://ethereal.email/message/test-preview");
jest.mock("nodemailer", () => ({
  createTestAccount: (...args) => mockCreateTestAccount(...args),
  createTransport: jest.fn(() => ({ sendMail: (...args) => mockSendMail(...args), verify: jest.fn().mockResolvedValue(true) })),
  getTestMessageUrl: (...args) => mockGetTestMessageUrl(...args),
}));

const nodemailer = require("nodemailer");
const emailTransport = require("../services/emailTransport");
const originalFetch = global.fetch;

afterEach(() => {
  delete process.env.ALERT_EMAIL_TRANSPORT;
  delete process.env.ALERT_EMAIL_ENABLED;
  delete process.env.ALERT_EMAIL_FROM;
  delete process.env.SENDGRID_API_KEY;
  mockSendMail.mockClear();
  mockCreateTestAccount.mockClear();
  mockGetTestMessageUrl.mockClear();
  nodemailer.createTransport.mockClear();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test("SendGrid transport posts plain-text content and accepts its queued response", async () => {
  process.env.ALERT_EMAIL_TRANSPORT = "sendgrid";
  process.env.ALERT_EMAIL_FROM = "verified@example.test";
  process.env.SENDGRID_API_KEY = "test-only-not-a-real-key";
  global.fetch = jest.fn().mockResolvedValue({ status: 202, headers: { get: () => "provider-id" } });
  await expect(emailTransport.send({ to: "admin@example.test", subject: "Cold-chain alert", text: "Synthetic test" }))
    .resolves.toEqual({ providerMessageId: "provider-id", simulated: false, transportMode: "sendgrid" });
  expect(global.fetch).toHaveBeenCalledWith("https://api.sendgrid.com/v3/mail/send", expect.objectContaining({
    method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-only-not-a-real-key" }),
    body: expect.stringContaining('"type":"text/plain"'),
  }));
});

test("provider rejection records a safe status-only error", async () => {
  process.env.ALERT_EMAIL_TRANSPORT = "sendgrid";
  process.env.ALERT_EMAIL_FROM = "verified@example.test";
  process.env.SENDGRID_API_KEY = "test-only-not-a-real-key";
  global.fetch = jest.fn().mockResolvedValue({ status: 401, headers: { get: () => null } });
  await expect(emailTransport.send({ to: "admin@example.test", subject: "x", text: "y" }))
    .rejects.toThrow("Email provider rejected delivery (401)");
});

test("console transport is explicitly a local preview and requires no API key", async () => {
  process.env.ALERT_EMAIL_TRANSPORT = "console";
  const output = jest.spyOn(console, "info").mockImplementation(() => {});
  await expect(emailTransport.send({ to: "demo@example.test", subject: "Demo", text: "Preview only" }))
    .resolves.toEqual({ providerMessageId: null, simulated: true, transportMode: "console" });
  expect(output).toHaveBeenCalledWith(expect.stringContaining("[email:console]"));
});

test("Ethereal transport sends over SMTP and returns a captured-message preview", async () => {
  process.env.ALERT_EMAIL_TRANSPORT = "ethereal";
  await expect(emailTransport.send({ to: "admin@example.test", subject: "Cold-chain alert", text: "Captured demo" }))
    .resolves.toEqual({ providerMessageId: "ethereal-message-id", previewUrl: "https://ethereal.email/message/test-preview",
      simulated: true, transportMode: "ethereal" });
  expect(mockCreateTestAccount).toHaveBeenCalledTimes(1);
  expect(nodemailer.createTransport).toHaveBeenCalledWith({ host: "smtp.ethereal.email", port: 587, secure: false,
    auth: { user: "ethereal-user@example.test", pass: "ethereal-test-password" } });
  expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin@example.test", subject: "Cold-chain alert", text: "Captured demo" }));
});

test("Ethereal readiness probes SMTP without returning mailbox credentials", async () => {
  process.env.ALERT_EMAIL_ENABLED = "true";
  process.env.ALERT_EMAIL_TRANSPORT = "ethereal";
  const result = await emailTransport.health();
  expect(result).toMatchObject({ status: "healthy", healthy: true, reachable: true, mode: "ethereal",
    simulated: true, previewAvailable: true });
  expect(JSON.stringify(result)).not.toMatch(/password|ethereal-user|smtp\.ethereal/i);
});
