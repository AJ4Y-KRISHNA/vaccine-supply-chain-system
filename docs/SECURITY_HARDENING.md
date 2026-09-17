# Local prototype security hardening

This is demo software, not a certified clinical or production deployment.

## Implemented

- JWT signatures require configured independent random access/refresh secrets (at least 32 characters), HS256, issuer, audience and token purpose. The current database account determines role, disabled state and token version. The legacy `AUTH_OPTIONAL` bypass is removed; startup rejects it.
- Four local demo passwords were bcrypt-hashed with cost 12, retaining their existing values. Token versions were incremented; log in again. Plaintext authentication is no longer accepted. Password fields are excluded from normal queries/API responses.
- Legacy dashboard, admin, shipment, order, manufacturing, distribution, vaccination, feedback, forecast, sentiment and decision routes require authentication and applicable roles. Organization-scoped queries are used before summaries are calculated. Batch lookups are restricted to owned/assigned batches.
- Operational guards check manufacturer ownership and assigned distributor/hospital identity, reject protected release/hold fields and organization impersonation. Administrative reassignment remains distinct from routine recipient actions.
- Demo organization aliases come from the explicitly authorized reconciliation, not client claims. Account/alias management has no generic public write endpoint.
- Failed browser login no longer enters a role-only dashboard. Protected pages require a token; the backend remains the authority.
- Authentication is rate-limited. JSON bodies have a 256 KB limit; Mongo operator/prototype field names are rejected at the application boundary. CORS is restricted to configured frontend origins. Backend binds to loopback by default and waits for MongoDB before accepting traffic.
- Removed a legacy private-key console log. Existing local secrets were retained; missing JWT, refresh and ingestion keys were generated in ignored `.env`. `.env.example` contains placeholders only.
- `seed.js --execute` only adds missing hashed demo accounts; it no longer deletes existing users. `hardenDemoAccounts.js` is local-only, dry-run by default, and preserves existing password values while hashing. Neither script is run automatically at startup.

## Remaining deployment concerns

Existing demo passwords are intentionally unchanged and still unsuitable for a public deployment. Tokens are stored in browser local storage; XSS hardening, cookie-based session design, TLS, managed secret rotation, refresh-token rotation/reuse detection, dependency review and independent penetration testing are future production work. Smart-contract authorization is a separate roadmap step. In-process locks are not distributed transactions; legacy stock workflows still need full ledger enforcement. Do not expose this demo directly to the public Internet.

The versioned temperature ingestion API remains API-key authenticated with its original payload/response shape. Do not put its API key in public frontend code.
