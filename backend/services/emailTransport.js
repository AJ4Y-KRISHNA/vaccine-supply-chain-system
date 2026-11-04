let etherealAccount;
let etherealMailer;
let lastEtherealCaptureAt = null;

async function getEtherealTransport() {
  const nodemailer = require("nodemailer");
  if (!etherealAccount) {
    etherealAccount = nodemailer.createTestAccount().catch(error => { etherealAccount = null; throw error; });
  }
  const account = await etherealAccount;
  if (!etherealMailer) etherealMailer = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
  return { nodemailer, account, mailer: etherealMailer };
}

async function sendViaEthereal({ to, subject, text }) {
  // Ethereal is an SMTP capture mailbox. This runs Nodemailer's actual SMTP
  // send path while preventing demo alerts from reaching real recipients.
  const { nodemailer, account, mailer } = await getEtherealTransport();
  const info = await mailer.sendMail({ from: `Vaccine Cold-Chain Demo <${account.user}>`, to, subject, text });
  lastEtherealCaptureAt = Date.now();
  return {
    providerMessageId: info.messageId || null,
    previewUrl: nodemailer.getTestMessageUrl(info) || null,
    simulated: true,
    transportMode: "ethereal",
  };
}

async function health() {
  if (process.env.ALERT_EMAIL_ENABLED !== "true") return { status: "disabled", healthy: false,
    reachable: false, mode: String(process.env.ALERT_EMAIL_TRANSPORT || "console").toLowerCase(), simulated: true,
    previewAvailable: false, failure: "email-delivery-disabled" };
  const mode = String(process.env.ALERT_EMAIL_TRANSPORT || "sendgrid").trim().toLowerCase();
  if (mode === "ethereal") {
    const { mailer } = await getEtherealTransport();
    await mailer.verify();
    return { status: "healthy", healthy: true, reachable: true, mode, simulated: true, previewAvailable: true };
  }
  if (mode === "console") return { status: "simulated-only", healthy: false, reachable: false, mode, simulated: true,
    previewAvailable: false, failure: "console-transport-does-not-send-email" };
  if (mode === "sendgrid" && process.env.SENDGRID_API_KEY && process.env.ALERT_EMAIL_FROM) {
    return { status: "configured", healthy: false, reachable: false, mode, simulated: false, previewAvailable: false,
      failure: "provider-connection-not-probed" };
  }
  return { status: "unconfigured", healthy: false, reachable: false, mode, simulated: mode === "ethereal",
    previewAvailable: false, failure: "email-provider-not-configured" };
}

function hasRecentEtherealCapture({ now = Date.now(), maxAgeMs = 60_000 } = {}) {
  return lastEtherealCaptureAt !== null && now - lastEtherealCaptureAt <= maxAgeMs;
}

async function send({ to, subject, text }) {
  const transport = String(process.env.ALERT_EMAIL_TRANSPORT || "sendgrid").trim().toLowerCase();
  if (transport === "ethereal") return sendViaEthereal({ to, subject, text });
  if (transport === "console") {
    console.info(`[email:console] to=${to} subject=${subject}\n${text}`);
    return { providerMessageId: null, simulated: true, transportMode: transport };
  }
  if (transport !== "sendgrid") throw new Error("Unsupported alert email transport");

  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("SendGrid alert email is not configured");
  if (typeof fetch !== "function") throw new Error("This Node.js runtime does not provide fetch for email delivery");

  let response;
  try {
    response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: "text/plain", value: text }],
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new Error(error?.name === "TimeoutError" ? "Email provider request timed out" : "Email provider request failed");
  }
  if (response.status !== 202) throw new Error(`Email provider rejected delivery (${response.status})`);
  return { providerMessageId: response.headers?.get?.("x-message-id") || null, simulated: false, transportMode: transport };
}

module.exports = { send, health, hasRecentEtherealCapture };
