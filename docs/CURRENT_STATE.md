# Current State — Phase 11

Checked 2026-10-07. **Synthetic software simulation, not clinical or production.**
Current-phase execution evidence is recorded in [PHASE11_FREEZE.md](PHASE11_FREEZE.md).
Historical verification is not a claim that a command was rerun today.

## Architecture and scope

Simulator → authenticated MQTT / local HTTP fallback → Edge Gateway → authenticated
ingestion → Redis Streams → separate worker consumer groups → MongoDB replica set,
policy outbox, advisory AI and time-windowed Merkle roots on local Hardhat →
role-scoped REST/WebSocket dashboards. Manual/CSV entry joins the same ingestion
pipeline. Private Compose traffic is HTTP/MQTT; remote TLS termination is not
demonstrated.

| Module | Current implementation | Source / verification boundary |
|---|---|---|
| Simulator | Seeded normal, door-open, compressor-drift, flatline, GPS-jump, link-loss. Sensor values, timestamps, vehicle/batch IDs and injected ground truth are synthetic. Route progress uses elapsed time; both injected GPS offset/return transitions are labelled. | `backend/services/iotSimulator.js`; unit tests, platform evaluation and detector experiment. |
| Edge | Authenticated separate gateway; durable ordered store-and-forward, send-on-change/heartbeat, time-based EWMA, rolling context and C/min rate. Physical GPS rule above configurable 120 km/h. | `backend/edge-gateway/`; math/validation tests and acceptance checks stored GPS advisory fields. Deployed local temperature threshold is immediate; calibrated statistical hysteresis is **evaluation-only**, explicitly documented in ADR-015/results. |
| Ingestion | Shared Joi validation, timestamp limits, device/sequence idempotency; accepted events have correlation/event IDs and enter Redis Streams. Compatibility synchronous mode retained. | `backend/services/telemetryValidation.js`, `telemetryService.js`, `eventBackbone.js`; Jest/acceptance. |
| Consumers | Separate `backend/worker.js`: persistence, policy-alert, AI advisory, anchoring, outbox/email; retries and dead letters. API in external-worker mode does not run these loops. | `backend/services/eventConsumers.js`, `backend/worker.js`; API-restart acceptance. Consumer groups are logical independent loops in one worker, not separate processes per group. |
| Database | MongoDB replica set; readings, time-series measurement projection, location, users, policy, audits, outbox, inventory/orders, forecasts and Merkle proof metadata. Retention/indexes. | `backend/models/`; isolated replica-set Jest and acceptance. Test stack has separate tmpfs Mongo, network, Redis/broker/AI/chain. |
| Policy | Approved per-batch policy opens/updates/closes excursion alerts and outbox transactionally. Policy alone controls safety holds. | `backend/services/temperatureAlertService.js`, `eventConsumers.js`; simulated/manual excursion acceptance and Jest. |
| AI | Normal-only temperature feature scales and held-out normal cutoff; time-based 30-minute context, EWMA decay, 60-second-bin C/min rate, flatline seconds, five-minute timestamped warm-up; raw and 2-of-3 persisted advisory. GPS is a separate immediate physical rule. Humidity is an explanatory metric, not learned. | `ai-services/normal_detector.py`, `anomaly_detection.py`; Pytest, seeded experiment. Live consumer forwards coordinates and up to 1,000 timed prior fixes. No clinical classifier or learned GPS feature. |
| Forecast | Regional synthetic order series; SARIMA versus seasonal-naive comparison, intervals/provenance and metrics. | `ai-services/forecasting/regional.py`, backend analytics routes; platform evaluation and Pytest/Jest. Synthetic holdout selection is not external forecast validation. |
| Optimization | Constrained LP with checked fallback, shelf-life/inventory/capacity assumptions; authorization required for review approval. No automatic stock dispatch. | `ai-services/forecasting/allocation.py`, `backend/controllers/analyticsController.js`; API/unit tests. Seed stock can correctly be ineligible until release gates pass. |
| Blockchain | Batch/lifecycle records and Merkle root/window metadata; raw leaves/proofs remain MongoDB. Default window 300 s in code, Compose demo 30 s. Local chain 31337. | `blockchain/`, `backend/services/merkleAnchoring.js`; Hardhat tests, acceptance and live tamper fixture. Hardhat history is volatile. |
| Notifications | Durable in-app/outbox and optional Ethereal capture with preview link; bounded retries. Readiness SMTP timeout 10 s and cache 60 s, degraded if capture works despite slow probe. | `backend/services/notificationDispatcher.js`, `emailOutbox.js`, `systemReadiness.js`; acceptance/Jest. Not production email delivery. |
| Dashboards | Role-authorized REST + WebSocket updates; degraded polling fallback; maps, charts, alerts, analytics/reports per role. Field panel retains synthetic notice. | `frontend/src/`, `field-operator-panel/src/`; frontend 38 suites/160 tests, field panel 12 files/59 tests executed this phase. Visual Chrome/Safari QA **not verified**. |
| QR | Dynamic verification URL per batch; authenticated verify UI/API distinguishes batch identity from yes/pending/no sensor anchoring. | `frontend/src/components/BatchVerificationQr.js`, `backend/controllers/merkleVerificationController.js`; UI/unit and acceptance checks. Not public unauthenticated field scanning. |
| Manual entry | Role-protected manual/CSV orders, inventory and readings; source/actor/note, plausibility flags, append-only correction and audit. Same stream/policy/AI/anchoring pipeline. | `backend/routes/readingRoutes.js`, `manualReadingController.js`; manual 11 C acceptance, permissions and correction/tamper tests. |
| Platform | Ten Compose services: Mongo, Mosquitto, Redis, Hardhat, AI, API, worker, edge, frontend, field panel. Worker heartbeat checked by readiness; worker has no separate Docker healthcheck. | `docker-compose.yml`, isolated `docker-compose.test.yml`; clean-stack build/up/seed and dependency probes recorded in Phase 11 evidence. |

## Phase 11 changes and measurement protocol

See ADR-015 and the frozen `results/ai_vs_threshold.json` / `.md`.
Training seed 90210, default calibration 90211 and external
`phase11-cal-normal-*` seeds are disjoint from baseline `phase11-eval-*` and
all `phase11-robust-*` seeds. Calibration uses original settings only.
Thirty runs per baseline scenario and each of seventeen robustness conditions
completed: 400 active + 12 warm-up samples/run, 271,920 evaluation samples
excluding calibration. Saved reports include per-scenario mean/SD, prevalence
estimates and all 35 method/condition pairs with normal-sample FAR above 10%.
False advisory episodes per normal hour count rising edges, not positive samples.
Before/after compares archived Phase 10 versus independent Phase 11 evaluation
seeds, not a paired experiment. Route cadence and GPS transition labels also
changed; the result is not a causal estimate of time normalization alone.
The live AI uses its embedded Python calibration cutoff (seed 90211); the
benchmark supplies a cutoff calibrated once on ten separate original-setting
simulator-normal runs. Its performance figures therefore describe that benchmark
operating point, not an exact deployed-default-cutoff performance measurement.

## Known limitations for the viva

- All data/labels, GPS and demand are synthetic, not clinical ground truth.
- Policy thresholds are authoritative. AI scores, trend review and physical GPS
  plausibility are advisory, not safety certification.
- The final results list every measured condition with pooled normal-sample FAR
  above 10%. Noise ×2 may itself breach policy on an injection-labelled normal
  sample; comparator FAR is against injection labels.
  Persisted AI normal FAR remains 44.6764% under noise ×2, despite improving
  10-second sampling FAR to 0% on the evaluated seeds. The statistical edge
  comparator misses baseline door-open; authoritative policy checks do not.
- Deployed gateway local temperature thresholds are not the evaluation-only
  calibrated statistical edge detector/hysteresis.
- The live plan/approval proof returned zero allocation because seeded batches
  were not manufacturing-released; it preserved stock. Positive live allocation
  is not verified in that proof. Exactly repeating synthetic seasonal history
  gives near-zero forecast errors/interval widths, not real demand validation.
- Sampling below the 1,000-point context cap may truncate the 30-minute horizon;
  invalid/non-increasing GPS timestamps produce no fabricated speed.
- Local Hardhat restarts lose chain history. Volume resets also delete Mongo,
  Redis, broker and saved analytics data.
- Ethereal captures test mail only; remote TLS, public chain, hardware, real email,
  Safari/browser visual QA and production benchmarking are **not verified**.
- Existing dependency audit advisories remain; no unsafe forced upgrades were
  applied. This freeze is for a local thesis demo, not deployment approval.

## History

The full pre-Phase-11 state and execution records are preserved in
[CURRENT_STATE_PHASE10.md](history/CURRENT_STATE_PHASE10.md). They describe
earlier phases, including baseline flaws, failed attempts, historical counts and
subsequent repairs. Current-source claims above supersede historical architecture
descriptions. Earlier phases evolved the existing repository; no rewrite or
removal of its compatibility workflows is claimed.
