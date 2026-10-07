# Architecture Roadmap Execution Log

Updated: 2026-10-04

This log records checks and implementation work for the software-based architecture alignment roadmap. The target remains a synthetic local demonstration, not a clinical or production cold-chain system.

## Phase 0 — Baseline and repeatable proof

### Starting state

- The workspace was already on `codex/ordered-roadmap-20260917`; it was not switched or recreated.
- The worktree contained pre-existing changes. They were preserved and not reset.
- Before implementation changes, the backend suite reported 28 passing suites and one failing suite (213/215 tests passed). Both failures were in `manualOverrideE2E.test.js`: its simulator used the real HTTP transport, but that unit harness did not mount or serve the temperature-ingestion endpoint.
- At the same starting point, the React frontend passed 32 suites / 131 tests, the Field Operator Panel passed 11 files / 53 tests, and Hardhat passed 4 tests.

### Baseline smoke findings and fixes

The existing end-to-end acceptance runner uses a fresh `codex_cc_test_<random>` MongoDB database, local Hardhat and AI services, and removes only that database during cleanup. Its first run exposed that the simulator defaulted to port 5000 rather than the runner's random API port. After routing it to the isolated API, the real ingestion path exposed that automatic simulator readings send nullable override metadata, which the Joi validator rejected. Once ingestion proceeded, the tick held a batch mutex across HTTP while the receiver tried to acquire the same mutex, causing a deadlock. The simulator now snapshots/tags under the mutex and releases it before HTTP ingestion; a concurrent override is therefore applied to the next sample, never retroactively to the pending sample. The unit test harness now serves the real ingestion route on a private ephemeral port.

### Verified acceptance result

`backend/scripts/runSystemAcceptance.js --execute` completed with `PASS` on 2026-10-04:

- 46 authenticated HTTP requests across four disposable role accounts.
- Manufacturer batch creation and two-address release recorded on local chain ID 31337.
- Forecast and supply allocation: 40 synthetic doses allocated from a 100-dose batch.
- Four sensor readings stored; a sustained high-temperature excursion quarantined the batch.
- Verified notification records reached admin and manufacturer; the live-shipment API returned the latest reading and active hold.
- Acknowledgement, operator action, recovery, quality review, and clearance completed in order.
- Delivery and one idempotent administration completed.
- 15 of 15 local-chain audit anchors verified; replay created no duplicates.
- Simulator tick request latency in this run: 51–92 ms (median 65 ms). These are local test measurements, not a performance guarantee.

The runner reported that its isolated database and child services were cleaned up. The application database was not used.

## Phase 1 — Simulator and location history

Implemented:

- Kept the simulator's authenticated HTTP POST ingestion, which is one of the two transports explicitly allowed by the target diagram. MQTT remains unconfigured; the supplied phase notes disagree on whether it is required, and the diagram itself accepts HTTP or MQTT.
- Added MongoDB `LocationHistory` points for batch-linked sensor records with valid coordinates. Each point is linked uniquely to its `TemperatureLog`, so HTTP retries do not duplicate GPS history.
- Added authenticated, role-scoped `GET /api/location-history/:batchId?limit=500` and a frontend API helper for that feed.
- Changed the main simulator panel's default interval from 60 seconds to 5 seconds; the backend generator's existing default was already 5 seconds.

Verification on 2026-10-04:

- Location-history route and telemetry-idempotency tests: 8 passed.
- Simulator-panel frontend tests: 7 passed.
- Full backend suite: 30 suites / 219 tests passed. Full frontend suite: 32 suites / 132 tests passed. Field Operator Panel and Hardhat suites were unchanged from Phase 0 and passed 53 and 4 tests respectively.
- The isolated end-to-end acceptance runner passed 47 HTTP requests and checked chronological location-history retrieval. It verified 15/15 local-chain audit anchors. That run's simulator tick latency was 53–101 ms (median 72 ms); this is a single local test run, not a performance guarantee.

## Phase 2 — Advisory inference, forecasting and supply optimization

Implemented:

- Added a FastAPI rolling median/MAD statistical anomaly endpoint for temperature and optional humidity. It emits per-metric sample counts, baseline, deviation, threshold and human-readable reasons. Fewer than five historical points is reported as `INSUFFICIENT_HISTORY`, not normal. It is advisory only and not trained on labeled failures.
- Connected backend telemetry ingestion to up to 30 earlier readings for the same batch/device, excluding points already flagged as model outliers from later baselines. The AI call has a 750 ms default cap (`AI_ANOMALY_TIMEOUT_MS`, bounded to 100–5000 ms) and fails open. A stored model result or unavailable status is added to the persisted `TemperatureLog.evaluation` and role-scoped batch story; a policy alert may carry the separate inference context. Existing approved policy rules alone set alert severity and quarantine.
- Added seasonal-naive-12 as a demand-forecast candidate only for explicitly monthly histories with at least 24 contiguous observations. Candidate selection and reporting still use chronological expanding-window prefix evaluation followed by an untouched suffix. Other caller-provided series remain on naive, trailing-three-mean and drift baselines unless their provenance explicitly identifies monthly periods.
- Replaced greedy allocation with a deterministic min-cost max-flow planner. It maximizes filled dose quantity, then prefers higher-priority orders, earlier-expiry eligible batches and shorter entered transit times while respecting product matching, release/hold eligibility, arrival-before-expiry, order demand, shared hospital capacity and total transport capacity. It remains advisory; it does not plan real road routes, reserve stock or dispatch.
- Updated the Admin planner description/table and current-state architecture, supply-planning and cold-chain documentation to match the implemented behavior and its limits.

Verification on 2026-10-04:

- AI-service unit tests: 14 passed, covering anomaly reasons, insufficient baseline, humidity, endpoint registration, seasonal baseline gating and chronological holdout.
- Full backend regression: 31 suites / 224 tests passed, including ingestion integration, alert authority, batch-story exposure, planner constraints/priority/route cost and fail-open AI calls.
- Full frontend regression: 32 suites / 132 tests passed. The optimized frontend production build compiled successfully.
- `backend/scripts/runSystemAcceptance.js --execute` passed against a fresh disposable MongoDB database and local Hardhat/AI services. It exercised five HTTP-ingested normal baseline points, real backend-to-AI anomaly inference, persisted explanation in the batch story, the existing alert → quarantine → notification → review → delivery flow, forecast, constrained plan and local-chain verification (20/20 audit anchors). It reported 49 HTTP requests. The runner removed only its isolated database and stopped its child services.
- `git diff --check` reported no whitespace errors; Git emitted only its existing line-ending normalization warnings.

Limits retained deliberately: statistical anomaly output is not a learned/validated safety model; it does not create separate model-only alerts or quality holds. Seasonal forecasting is available only for explicitly monthly data and remains deterministic. Supply planning optimizes the modeled allocation inputs, not actual road networks, vehicle fleets or cold-storage constraints.

## Phase 3 — Append-only on-chain telemetry and QR proof

Implemented:

- The local contract now stores full batch-linked sensor readings: record ID, commitment, batch/device/vehicle/shipment, event timestamp, temperature, optional humidity/battery and optional GPS. Decimal fields use integer scaling; the contract recomputes the SHA-256 commitment from the submitted fields before accepting a record.
- The MongoDB-backed worker queues the existing reading digest and the raw contract record as separate retryable operations. A chain outage still cannot block telemetry evaluation or policy enforcement. Identical on-chain retries are idempotent; mismatched values/digests for a record ID are rejected.
- The contract appends batch status history rather than overwriting prior statuses, permits each production/lab sign-off once, and prevents replacing an issued inventory certificate. Local-contract status and telemetry history are readable by index.
- Added authenticated, role-scoped paginated `GET /api/batches/:batchId/on-chain-telemetry`; the Blockchain Audit panel can read/render sensor history directly from contract state. The readiness panel distinguishes raw on-chain records from their digest anchors.
- Manufacturer QR payloads now include local chain/contract metadata and the latest on-chain sensor record ID/digest when available. The Healthcare verifier checks the proof against the configured local contract; batch-only QR/manual ID use is labeled as batch identity only.
- Updated current-state documentation and local-chain setup notes. An updated contract must be compiled and redeployed locally because previous deployments do not expose the new interface.

Verification on 2026-10-04:

- Six real Hardhat contract tests passed, including raw reading storage/commitment/replay, append-only status history, one-time certificate/sign-offs and previous writer/signature controls.
- Focused backend tests: 4 suites / 39 tests passed. Focused frontend tests: 4 suites / 14 tests passed.
- The isolated full HTTP acceptance run passed with 52 requests on MongoDB, FastAPI and a newly deployed local chain. It verified 20 combined evidence entries (11 digest anchors plus 9 raw telemetry records); read the raw history endpoint; constructed a QR proof from the latest chain reading; verified its digest through the role-scoped API; and confirmed replay adds no duplicates. Only the generated disposable database was removed.
- Regression at Phase 3 completion on 2026-10-04: full backend suite 32 suites / 230 tests passed; full frontend suite 32 suites / 134 tests passed; AI-service suite 14 tests passed; Field Operator Panel 11 files / 53 tests passed; Hardhat contract suite 6 tests passed; optimized frontend production build compiled successfully.
- `git diff --check` passed with no whitespace errors; Git emitted only line-ending normalization warnings for the Windows working tree.

Limits retained deliberately: the chain is local, ephemeral and centrally operated. The current QR browser flow calls the authenticated backend; the QR carries sufficient public chain metadata/hash for an independent local reader, but does not connect directly to a wallet or public RPC. MongoDB remains the application query source. No real networks, funds, clinical data or hardware are used.

## Phase 4 — Optional alert email delivery

Implemented:

- Policy alert stages continue to persist deduplicated in-app notifications first. When `ALERT_EMAIL_ENABLED=true`, separate email records are queued for each active administrator and account mapped to the affected manufacturer's organization; distributor and healthcare notification behavior remains in-app only.
- Added a MongoDB email outbox with idempotent per-recipient queueing, attempt counts, bounded exponential retry scheduling, stale-worker recovery, persistent provider errors, and an admin-only delivery-status endpoint. Email enqueue/provider failures are caught separately and do not suppress or roll back in-app notifications or cold-chain policy actions.
- Added explicit `console` preview and SendGrid HTTPS transports. Console mode is recorded as `simulated`; SendGrid delivery is marked accepted only after HTTP 202. API keys and sender configuration are read only from environment variables.
- The worker starts only after MongoDB connects and email is explicitly enabled. Historical notifications are not automatically backfilled when email is enabled later.

Verification on 2026-10-04:

- Focused email tests: 4 suites / 9 tests passed, covering admin/manufacturer routing, deduplication, retry/backoff and stale-worker recovery, transport success/failure, admin-only status visibility, and in-app independence during queue failure.
- Phase 4 backend regression: 36 suites / 239 tests passed. The integrated acceptance runner was rerun with email explicitly disabled and passed its 52-request simulator → database → AI/rules → notification → local chain → QR workflow. No real email was sent; provider behavior is covered by mocked transport tests.
- The SendGrid request is mocked in automated tests; no real email was sent. Console transport is a local log preview, not mailbox delivery.

Limits retained deliberately: the SendGrid API key, a verified sender address and an explicitly enabled setting are required for external mail. Provider HTTP 202 means accepted by SendGrid, not confirmed in the recipient's inbox. If SendGrid accepts a message but the client times out before recording that response, a later retry can duplicate it. The single-process prototype does not provide a user-facing mail configuration UI; secrets belong in the ignored local environment file, never source control.

## Phase 5 — Main-dashboard geographic GPS history

Implemented:

- Replaced the role dashboards' workflow-position truck diagram with a geographic map backed by the authenticated, role-scoped saved GPS-history endpoint. The visualizer loads chronological batch history for the visible shipments and only associates points carrying the exact shipment ID; a legacy point with no shipment ID is used only when the batch has one shipment in the returned role-visible list.
- Added the shared Leaflet map to Admin, Manufacturer and Distributor dashboards. It draws a line through stored points, marks the first and latest saved positions, and shows timestamp/vehicle details for selected points. The Distributor's illustrative destination graphic was removed; its navigation now scrolls to the saved-history map.
- Preserved latest shipment readings, policy and alert details beside the map. If history has no valid coordinates, the UI explains how to generate saved GPS data. If history fails, it reports the failure and can still show the latest location returned by the shipment feed.
- Updated `ARCHITECTURE.md`, `README.md` and `docs/LIVE_SHIPMENT_VISUALIZER.md` to describe the integration and its limits.

Verification on 2026-10-04:

- Full frontend regression: 33 suites / 140 tests passed. This includes history API usage, coordinate validation, exact shipment filtering, ambiguous batch-only point rejection, legacy single-shipment handling, chronological current-position handling, alerts and dashboard component coverage.
- Focused backend regression: 3 suites / 10 tests passed for chronological, role-scoped location-history retrieval and telemetry/location idempotency.
- Optimized React production build compiled successfully.

Limits retained deliberately: coordinates are simulated/software-recorded, not physical or continuously live vehicle GPS. Lines are straight connections, not road-matched routes; the shipment destination is text because no destination coordinate is stored. OpenStreetMap base tiles require browser network access. The maps do not establish arrival, custody or vaccine safety.

## Phase 6 — Persistent Field Operator history and manual-entry audit

Implemented:

- Authenticated Field Operator WebSocket initialization now loads the latest 30 persisted `TemperatureLog` records and latest 30 `TemperatureAlert` records for the selected, role-authorized shipment. The records are sent chronologically in `INIT`; changing shipment clears the previous shipment's in-memory view.
- The panel hydrates its rolling sensor history and alert feed from that saved snapshot, then appends incoming live `READING` and `ALERT` events. Refreshing/reconnecting therefore restores saved history instead of starting with only the latest sample.
- Temperature and humidity charts show time-stamped samples, configured policy boundaries, and alert-open/quarantine/recovery markers when the event falls within the plotted samples. Policy/event colors indicate recorded evidence, not a safety determination.
- Rechecked the manually entered workflow surfaces across the roadmap. Batch/order/policy/simulator/operator/receipt/administered-dose fields are user-editable where appropriate; organization ownership, generated IDs, alert decisions and timestamps remain assigned or checked by the backend. The full accepted HTTP workflow verifies persistence and dashboard readback for synthetic form values. UI unit tests verify field validation and request payload wiring; they do not automate real browser keystrokes against a live database.

Manual-entry path audit:

| Role / surface | User-entered values | Save path and durable result |
| --- | --- | --- |
| Manufacturer batch form | Batch ID, product, quantity, supplier/material, expiry, remarks | `CreateBatchForm` → `POST /manufacturer/workflow` → manufacturing records and `Batch`; server assigns authenticated ownership; registration is anchored to the configured local chain. |
| Hospital order and administration | Region, product, requested doses, priority, notes; later synthetic patient/reference, doses used, reporting authority and notes | Hospital dashboard → `POST /orders/hospital` / `POST /vaccinations/workflow` → `Order`, administration and report/inventory records; confirmed stock is rechecked server-side. |
| Healthcare feedback | Synthetic feedback text, category, severity, batch, region, observation date and analytics consent | Healthcare feedback form → feedback API → `Feedback` collection when MongoDB is connected; the implementation has a process-memory fallback if the database is unavailable. The signed-in submitter identity is derived by the server. |
| Admin review/planning | Decision, allocation batch/distributor/note; planner capacity, transit and planning date | Admin dashboard → order review/supply-planning APIs → saved order/shipment or advisory `SupplyPlan`; a plan alone does not reserve stock or dispatch. |
| Admin sentiment analysis | Free-text sentiment sample | Admin textarea → sentiment service request and displayed response; this one-shot input/result is not saved as a supply-chain record. |
| Admin policy/reviewer | Cold-chain limits, reference, approval reason; reviewer-change reason | Policy and reviewer APIs → append-only policy revisions and reviewer audit. Reviewer access is role-checked. |
| Admin simulator / Field Operator | Device, vehicle, batch/shipment, seed, time interval, generator range and route; optional manual temperature/humidity targets, duration and reason | Simulator panel persists device/config and generated readings. Manual target overrides require the explicit backend and frontend feature flags; the backend records override/readings/audit and applies configured alert policy. |
| Distributor / hospital receipt | Distributor chooses workflow actions; hospital may enter receipt note | Role-scoped verify/dispatch/supply/confirm APIs → persisted shipment status/history and confirmed inventory. These are actions, not unrestricted shipment-state text edits. |
| Read-only inputs | QR batch/verification code, alert filters, dashboard search | These resolve/query existing records; they do not create or modify supply-chain records. |

Not every editable control is a durable data entry: dashboard filters/search, QR verification input, and Admin sentiment text are transient by design. Field Operator “Acknowledge locally” remains browser-session state only; it is not a backend alert acknowledgement. Admin alert actions use a separate audited backend workflow.

Re-verification on 2026-10-04:

- Field Operator WebSocket tests: 6 passed, including saved chronological history and alert lifecycle in a fresh subscription.
- Field Operator Panel full suite: 11 files / 55 tests passed.
- Main frontend full suite: 33 suites / 140 tests passed.
- Backend full suite: 36 suites / 239 tests passed.
- Local Hardhat contract suite: 6 tests passed.
- AI-service suite: 14 tests passed with `python -m unittest discover -s tests -v` after the user approved installing `pytest` in the local Python environment. No repository dependency manifest was changed for that environment setup.
- Cross-service system acceptance: PASS — 52 authenticated HTTP requests on isolated MongoDB, FastAPI and local Hardhat; it covered fresh form input, manufacture/release, hospital order, admin planning/approval, distributor delivery, hospital administration, telemetry/alert/quarantine/review, GPS, QR and chain proof. It verified 20 anchored audit events and 9 raw telemetry records; the disposable database and child services were removed afterward.
- Production builds: main React dashboard compiled successfully; Field Operator Vite build compiled successfully.

Limits retained deliberately: the panel restores at most 30 samples and 30 alert records per shipment subscription; older records remain in MongoDB and other history APIs but are not paginated in this panel. Local alert acknowledgement is still explicitly local-only and does not write a server acknowledgement. Manual temperature entry is a flagged simulator override, not direct editing of a stored sensor row.

## Phase 7 — Post-roadmap documentation accuracy audit

Completed:

- Rechecked the current-state `README.md` and `ARCHITECTURE.md` against the active routes, data models, environment examples, and AI/chain code. The scope notes distinguish implemented behavior from the preserved target design in `FUTURE_ARCHITECTURE.md`.
- Corrected out-of-range source citations in `ARCHITECTURE.md` (`backend/.env.example` and `backend/middleware/identityScope.js`). The references now point within the current files.
- Updated the Phase 6 Python test note to reflect the successful 14-test run, rather than the earlier missing-pytest limitation.
- Updated `SYSTEM_ACCEPTANCE.md` to identify its 52-request run as post-Phase-6 and to distinguish the fresh rerun from an earlier same-day timing sample. Relabeled the older 43-request UI audit and its regression counts as historical instead of “final.”
- Kept explicit boundaries visible: synthetic inputs, advisory AI, optional email, local-only chain, and no claim of clinical or production validation.

## Phase 8 — Final regression and integrated acceptance

Verification run on 2026-10-04; phases 7–8 made documentation-only changes and did not modify application code:

- Backend: 36 suites / 239 tests passed.
- Main React frontend: 33 suites / 140 tests passed; production build compiled successfully.
- Field Operator Panel: 11 files / 55 tests passed; Vite production build compiled successfully.
- AI services: 14 `unittest` tests passed.
- Hardhat local contract: 6 tests passed.
- Integrated acceptance: PASS, 52 authenticated HTTP requests through Express, MongoDB, FastAPI and Hardhat chain 31337. It verified 20 chain evidence records (11 digest anchors and 9 raw telemetry records), 4 sensor readings, QR proof, order/delivery/administration, alert/review/clearance and duplicate-safe replay. The run removed only its random `codex_cc_test_*` database and stopped its child services; the application database was unchanged.
- This run's four simulator tick requests measured 69–95 ms (median 94 ms); this is a single local test sample, not a performance guarantee.

No Phase 9 is defined in the repository roadmap. Remaining limitations are deployment/research gates, not unfinished steps in this local demonstration roadmap: real demand and incident validation, production-grade multi-instance durability/security, external chain governance, browser click-through of every role/viewport, and actual email-provider delivery remain outside the verified acceptance scope. Alert email remains opt-in and was disabled during acceptance.
