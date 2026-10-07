# Phase 7 — Acceptance, CI and evaluation

## Scope

This is a synthetic software-system acceptance and research harness. It does not establish clinical safety, field-device performance, production availability, or real-world model accuracy. Compose records and chain evidence created by acceptance/evaluation use unique `SYNTHETIC-PHASE7-*` identities and are retained so anchored evidence is not orphaned by automatic cleanup. No existing database or chain history is deleted.

## Run

Prerequisites: Docker Desktop/Engine, Node.js 20+, enough disk for the Compose images, and outbound access for initial image pulls and the disposable Ethereal SMTP capture. The root launcher creates a random ignored `.env` only when one is absent; an existing `.env` is never overwritten.

```powershell
node .\scripts\run-demo.js
node .\scripts\acceptance.js
node .\scripts\evaluate.js
```

`acceptance.js` waits for healthy services, seeds the four synthetic demo accounts, and runs `backend/scripts/phase7ComposeAcceptance.js` inside the backend container. It creates a uniquely named synthetic batch and shipment, registers the batch on local Hardhat, obtains an Admin-approved 2–8 °C policy through the API, and runs the deterministic `DOOR_OPEN` simulator profile. Each milestone is polled from the actual Mongo, REST, email-outbox and local-chain services and reported with elapsed time. A failed assertion returns non-zero. The ordered assertions are: saved reading; active policy alert with policy reason; in-app notification; sent Ethereal record and notification preview URL; confirmed Merkle root and gas metadata; alert returned by the dashboard alert API; and verified batch plus anchored reading returned by `/api/verify/:batchId`.

The acceptance runner leaves its uniquely named synthetic evidence in the current demo DB/chain. This is intentional: deleting a Mongo leaf after a root is committed would make verification report tampering. The CI job uses a fresh ephemeral environment and removes only its own containers/volumes after collecting results.

## Evaluation output

`node scripts/evaluate.js` writes a timestamped JSON file under `results/` and prints its path. The report contains scenario confusion counts/precision/recall/F1 using simulator profile labels as synthetic ground truth; p50/p95 timing for saved policy alerts, notifications and confirmed roots; accepted-ingestion throughput for 1, 10 and 50 virtual devices; link-loss recovery lost/duplicate counts; explicit AI/chain failure-isolation probe outcomes; measured gas per Merkle anchor and reading; and the seeded regional SARIMA-versus-seasonal-naive MAPE comparison. Zero actual-demand months are excluded from MAPE and counted separately. Performance figures are local single-run observations, not benchmarks.

The failure-isolation metric is a process-local consumer-handler fault-injection probe against the Compose Mongo/Redis services. It does not stop the running Hardhat or AI containers; this avoids erasing the user's local in-memory chain history. It verifies that persisted policy alerts remain after advisory AI unavailability and that chain-anchor retry failure does not roll back ingestion/alerts.

## CI

`.github/workflows/ci.yml` runs JavaScript syntax lint, field-panel ESLint, Python compile checks, backend/frontend/AI/field-panel unit tests, frontend and field-panel production builds, Hardhat contract tests, the Compose acceptance script and the evaluation harness. The CI runner uploads `results/*.json` as a 30-day artifact. CI creates an ignored local `.env` with random test-only secrets; nothing is committed as a credential.

Known external boundary: Ethereal account creation and SMTP capture need outbound network access. If a restricted environment blocks that service, acceptance fails at the email-capture milestone instead of treating an in-app record as an email success.
