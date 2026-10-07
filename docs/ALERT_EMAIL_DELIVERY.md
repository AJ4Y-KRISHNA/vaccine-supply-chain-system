# Optional cold-chain alert email

Cold-chain policy alerts always keep their existing role-scoped in-app notifications. Email is a separate, opt-in delivery path for active Admin accounts and the accounts mapped to the batch's owning Manufacturer. Assigned Distributor and Healthcare users continue to receive in-app notices only.

## Local preview

In `backend/.env`, set:

```dotenv
ALERT_EMAIL_ENABLED=true
ALERT_EMAIL_TRANSPORT=console
```

Restart the backend, then generate a synthetic policy alert. The backend prints a `[email:console]` message. The delivery record is marked `simulated: true`; this is only a local preview and does not send mail.

## SendGrid delivery

Configure these values in the ignored local `backend/.env` file. Do not commit or paste the API key into source files or screenshots.

```dotenv
ALERT_EMAIL_ENABLED=true
ALERT_EMAIL_TRANSPORT=sendgrid
ALERT_EMAIL_FROM=your-verified-sender@example.com
SENDGRID_API_KEY=your-private-sendgrid-api-key
ALERT_EMAIL_APP_URL=http://localhost:3000
ALERT_EMAIL_MAX_ATTEMPTS=5
ALERT_EMAIL_RETRY_BASE_MS=30000
```

The sender must be verified with SendGrid. Restart the backend after changing configuration. A provider HTTP 202 response is stored as accepted/sent by the provider; it does not prove inbox delivery or reading. The service uses a text-only message body.

## Queue, retries and status

Each alert-stage/recipient pair gets a unique delivery record in `EmailDelivery`; this prevents duplicate queue rows, not every possible duplicate email after an ambiguous provider timeout. The outbox worker starts after MongoDB connects and only when `ALERT_EMAIL_ENABLED=true`. Failures are retained with the last provider error and retry time. Defaults are five total attempts and a 30-second exponential retry base, capped at 24 hours; `ALERT_EMAIL_MAX_ATTEMPTS` accepts 1–10 and `ALERT_EMAIL_RETRY_BASE_MS` accepts 1–3,600 seconds. A worker lock older than five minutes is recovered on a later run; if the final allowed attempt was left in progress, the record is closed as failed. A provider outage does not block the in-app notification, quarantine, reviewer workflow or telemetry persistence.

An authenticated Admin can inspect the latest records through `GET /api/admin/email-deliveries`, optionally filtering with `?status=queued|sending|sent|failed` and `limit=1..100`. The response omits the stored subject and message body. No delivery record is created while email is disabled, and enabling email later does not backfill old alerts.

Automated tests mock the email sender/provider; they do not send real messages. The end-to-end application acceptance script runs with email disabled and creates only isolated synthetic database records.
# Readiness probe behavior

The Ethereal SMTP verify probe has a 10-second deadline, and its result is cached for 60 seconds to avoid repeatedly opening disposable SMTP connections. If verify times out but the API or worker has a successful Ethereal capture in the last 60 seconds (from process memory or a sent `EmailDelivery` record with a preview URL), readiness reports **Degraded**: the capture path has evidence of success but the live verify probe was slow. This is a synthetic demo transport, not a production email service.
