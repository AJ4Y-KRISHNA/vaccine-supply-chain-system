# Phase 11 final fixes and freeze

Synthetic software simulation only. Not clinical or production evidence.

## Fixed assumptions (before evaluating)

- GPS is a physical check, not a learned feature: haversine km divided by positive elapsed hours, strictly greater than `MAX_SPEED_KMH` (default 120). Missing fixes or non-increasing time produce no fabricated speed. Physical GPS alerts bypass statistical persistence in both AI and the evaluation edge comparator; they remain advisory.
- The seeded route progresses by elapsed time, with twenty minutes per leg, rather than advancing a fixed distance per sample. GPS injection labels cover both the outbound offset and the following return discontinuity, independent of any speed threshold.
- Temperature rate uses adjacent 60-second bin means and their actual centre separation, in degrees C/minute. EWMA decay is time-based with tau `-60/log(0.7)` seconds (the original alpha 0.3 at 60 s). The rolling window is 1,800 seconds. Flatline duration is seconds, not sample count. The database and sequence API supply up to 1,000 preceding fixes within this time window; beyond that bound history is truncated explicitly.
- Timestamped learned-temperature scoring requires five minutes of warm-up and at least five prior fixes. The explanatory trend uses twelve minutes rather than twelve samples. Missing timestamps retain the historical compatibility mode, but cannot establish physical rate or flatline duration. Humidity still has an independent explanatory deviation metric, not a learned detector feature.
- Learned temperature feature scales fit only original-setting synthetic normals using seed 90210. Default cutoff calibration seed 90211 and evaluation calibration `phase11-cal-normal-*` remain disjoint from baseline `phase11-eval-*` and robustness `phase11-robust-*`. No robustness settings are used to fit or recalibrate.
  The deployed API uses the embedded Python normal-set cutoff (seed 90211).
  The benchmark explicitly overrides it with its single cutoff calibrated on
  ten held-out simulator NORMAL runs. Both use original settings, but reported
  benchmark precision/FAR are not direct measurements of the deployed default
  cutoff. The API's default-calibration metadata remains default-model metadata;
  the experiment's actual cutoff/provenance are recorded in its report.
- Raw/persisted advisory episodes per normal hour count rising edges, not positive samples. Denominator is normal samples times interval / 3,600 and includes warm-up. Before/after uses the frozen Phase 10 report and different evaluation seeds, not a paired causal experiment.
  Route cadence and GPS transition labelling also changed between phases; the
  differences cannot be attributed solely to temperature-feature normalization.
- The deployed gateway preserves immediate local temperature-threshold advisories. It shares time math and the physical GPS rule, but does NOT deploy the evaluation-only calibrated statistical cutoff and 2-positive/3-negative hysteresis. This difference is exposed as `edge.ruleProfile`, tested, and repeated in JSON/Markdown. Approved batch policy is always authoritative.

## Evidence

The user approved a snapshot commit of the tested project and an annotated
`v1.0-viva` tag, excluding secrets, local environments and build outputs. Release
tagging follows the completed verification and bounded secret/whitespace checks.

Completed checks so far (2026-10-07):

Native runner: Node v24.19.0, Docker Compose v5.5.1, Git 2.54.0.windows.1.
Service images use their Dockerfile-pinned Node 20 / Python 3.11 bases. The local
Windows machine has about 7.7 GB visible RAM, so heavy verification jobs were
serialized; this environment is not a performance benchmark platform.

| Command | Executed result |
|---|---|
| `node node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand` (`CI=true`, frontend) | 38 suites, 160 tests passed; 92.824 s |
| `node node_modules/vitest/vitest.mjs run` (field-operator-panel) | 12 files, 59 tests passed; 23.26 s |
| project Python environment: `python -m pytest ai-services/tests -q` | Final rerun: 36 passed; 20.71 s |
| focused Jest edge math / durable link-loss tests | 2 suites, 6 tests passed; 5.132 s |
| native `node node_modules/jest/bin/jest.js --runInBand --testTimeout=180000` against isolated Compose dependencies | **59 suites / 354 tests passed; 192.31 s**. `NODE_ENV=test`, `EVENT_BACKBONE_ENABLED=false`, `MONGO_TEST_URI=mongodb://127.0.0.1:27019/?replicaSet=rs-test&directConnection=true`, Redis 6380, MQTT 1884, local test RPC 18545, simulator HTTP timeout 20 s. AI-dependent unit tests use their existing mocks/unavailable-service paths; this is not live AI proof. |
| final full native Jest command above, after the two drift-horizon tests were added | **60 suites / 356 tests passed; 218.498 s; exit 0**. Live API, worker, gateway and AI were temporarily stopped to avoid memory contention; isolated test dependencies were stopped afterward. Live Mongo and Hardhat were not reset. |
| `node scripts/lint.js` | Syntax checks passed for 239 backend, blockchain and runner JavaScript files; not an ESLint/style audit |
| final `node scripts/lint.js` after diagnostic additions | Syntax checks passed for **242** backend, blockchain and runner JavaScript files |
| `node node_modules/hardhat/internal/cli/cli.js test` (blockchain) | 9 contract tests passed; 10 s (independent local test EVM, not live verification-endpoint proof) |
| focused `platformEvaluationPlan.test.js` Jest run | 1 suite / 2 tests passed; 1.901 s. Drift horizon crosses 8 C and every generated timestamp stays past/inside the 24-hour ingestion bound. |
| `docker compose down -v; docker compose build` | Local demo volumes removed; all eight service images built, including the React production build |
| second clean `docker compose down -v; docker compose build; docker compose up -d --wait --wait-timeout 360; docker compose exec -T backend node scripts/seed.js` | **Passed** after pausing other workloads: nine healthchecked services healthy and external worker running; seed created 5 roles, 3 batches/policies, 3 inventory snapshots, 108 monthly orders |
| `docker compose exec -T backend node scripts/phase11ReadinessProof.js` | **Passed**: all five logins HTTP 200; authenticated readiness HTTP 200; backend/database/MQTT/Redis/worker/AI/blockchain/email healthy. Chain 31337, deployed contract 22,421 bytecode bytes; 30 s Merkle window; three roots confirmed at probe time. Credentials/tokens were not printed. |
| `node scripts/acceptance.js` (rerun with MQTT cleanup) | **Passed, exit 0**: simulated + manual evidence and deployed physical GPS advisory; separate worker opened an alert while API was stopped, then API recovered. Scenario milestones: reading 8,300 ms → alert 10,423 → in-app 10,967 → Ethereal capture 36,578 → confirmed root 36,619 → dashboard API 37,721 → verify API 39,392. Manual point was returned by chart history at 46,926 ms; deployed gateway + AI GPS proof at 64,154 ms. These are elapsed diagnostic wall times, not clinical sensor latency. |
| `docker compose pause worker; docker compose exec -T backend node scripts/liveMerkleChainProof.js; docker compose unpause worker` | **Passed** on the running chain: verification true → dedicated fixture tampered/rejected → restored/verified. Chain 31337, window 30 s, one reading, gas 141,086. Worker was resumed in `finally`. |
| `docker compose cp backend/scripts/phase11AnalyticsProof.js backend:/workspace/backend/scripts/phase11AnalyticsProof.js; docker compose exec -T backend node scripts/phase11AnalyticsProof.js` | **Passed**: 35 complete synthetic months, forecast comparison returned, plan HTTP 201, authorized approval HTTP 200; stock unchanged/no dispatch. Allocation was **zero**, not claimed positive. A separate read-only Mongo inspection found positive forecast demand (78/76/78 doses) but all three seeded batches were `BATCH_NOT_RELEASED`, with A additionally held. Nonzero live allocation requires the normal authorized manufacturing/release workflow; it was not executed in this proof. |
| corrected `node scripts/evaluate.js` | **Completed, exit 0**; `results/phase7-evaluation-2026-10-07T05-32-39-199Z.json`. All six policy smoke scenarios classified as expected; four buffered messages recovered in order, zero lost/duplicates. HTTP throughput: 66.67 / 77.52 / 86.06 messages/s for 1 / 10 / 50 devices (3 messages/device, not sustained-load testing). 50 roots confirmed; mean 186,237.12 gas/anchor and 143,259.32 gas/reading. Failure isolation passed direct consumer-handler probes, not physical container outages. |
| `docker compose -f docker-compose.test.yml run --rm --no-deps -e AI_BASE_URL=http://vaccine-ai-eval:8000 test-runner node scripts/evaluateAiVsThreshold.js` | **Completed, exit 0**. Dedicated AI image on the isolated test network; final report generated `2026-10-07T05:56:27.018Z`. Thirty runs for each of 5 baseline scenarios and 17 robustness conditions, 400 active + 12 warm-up samples/run; 271,920 evaluated samples excluding calibration. Original-only calibration; no evaluation-seed retuning. |
| Node assertions over the saved detector JSON | **Passed**: 5 baseline scenarios, 17 robustness conditions, every method has 30 runs. Final JSON/Markdown copied unchanged from `backend/results/` to root `results/`; archived Phase 10 retained. |
| first simultaneous full Jest + evaluation + clean startup attempt | **Not a pass**: simulator HTTP/WebSocket deadlines and one 3 s Mongo server-selection deadline failed under heavy resource contention. Startup was intentionally interrupted; no seed success is claimed for that attempt. |
| first launcher restore immediately after dependency unpause | **Not a pass**: shared images built and application services started, but the final Compose dependency check hit stale unhealthy statuses from the pause. No seed success is claimed. A subsequent read-only inspection confirmed Mongo/Redis/Mosquitto/Hardhat healthy; the launcher is rerun after recovery. No volume or chain reset was performed. |
| final `node scripts/run-demo.js` after dependency health recovered | **Passed, exit 0**: API/worker/gateway/AI images rebuilt, all ten services running (nine Docker healthchecks healthy), five synthetic accounts and fixtures seeded. Demo left running; original Hardhat instance retained. |
| first post-restore strict readiness script | **Not a pass**: Mongo round-trip probe failed its bounded readiness check during recovery. No timeout or assertion was relaxed. |
| authenticated inline Node fetch of `/api/admin/readiness` and the original reading verify endpoint | HTTP 200 with all eight checks healthy; Mongo round trip 332 ms, MQTT 211 ms, Redis 175 ms, worker 190 ms, AI 363 ms, chain 485 ms, email 2,722 ms. Original proof still `anchored=yes`, `verified=true`, with identical root/transaction after unpause. The full five-login strict script is rerun separately. |
| final `docker compose exec -T backend node scripts/phase11ReadinessProof.js` | **Passed, exit 0** after recovery: five logins HTTP 200, authenticated readiness HTTP 200, all eight service checks healthy. Contract bytecode 22,421 bytes, chain 31337, 111 windows confirmed, zero waiting/collecting, 30 s windows, mixed data mode. |

The Docker test runner bind-mounts Windows `node_modules`. An attempted dedicated
Linux test image was rejected after inspection: npm reported certificate-chain
errors (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`), misleadingly exited zero, and the
resulting image lacked Jest. That attempted Dockerfile was removed; TLS
verification was not disabled. The slow mounted-dependency suite was interrupted
and a native Node/Jest rerun was started against the same isolated Compose Mongo
replica set (`27019`, direct connection), Redis (`6380`) and MQTT (`1884`). No live
database is used and no test assertions/cutoffs were relaxed. Both complete
native reruns passed; the final one includes the new smoke-protocol tests.

The run helper now rebuilds API, worker, gateway and AI together, preventing
stale external consumers after a shared-backend edit.

An acceptance attempt observed all fifteen scenario milestones, including the
stored gateway/AI physical-GPS advisory, but did not exit: the diagnostic's new
MQTT publisher retained its keepalive. Its teardown now calls the existing tested
`stopTelemetryClient()` before Mongo disconnect. That attempt was interrupted,
not reported as a complete `scripts/acceptance.js` pass; the subsequent full rerun
passed and exited zero, as recorded in the table.

Live Merkle proof transaction:
`0x99cbed051f2552fa810809cfaad71fb004c83c9aba2fca8af9aa74fe10e14ea5`.
Root: `0xc9af33a9d16fe8fc71cb05bc418cef28937854fee1f3dad8b31d29ff5528a6d5`.
The dedicated synthetic batch is `PHASE8-LIVE-1791350564345`; its historical
fixture prefix does not imply that this proof was run in Phase 8. It was run
today against the rebuilt Phase 11 stack. The root commits integrity, not vaccine
quality or physical handling.

The platform smoke evaluator had a stale compressor-drift protocol: 40 samples
at 5 s covered only 195 s while it expected a temperature excursion. A direct
simulator run with seed `platform-protocol-audit-not-calibration` measured
2.04–2.69 C and zero breaches. `platformEvaluationPlan.js` now uses 40 one-minute
samples for that scenario, backfills the whole horizon and gives that cadence a
120 s missing-reading allowance. Approved temperature limits remain 2–8 C.
This repairs the smoke experiment, not the learned detector: no calibration or
held-out evaluation seed/setting is changed. The earlier platform run
`phase7-evaluation-2026-10-07T05-26-23-333Z.json` exited zero but its drift
classification failed. It is historical, not the final successful result.
The corrected evaluator completed successfully before freezing.

Platform latency is diagnostic only: backfilled sensor-time-to-alert p50/p95
558,216/735,883 ms includes artificial timestamp age. Wall tick-to-alert-observed
p50/p95 was 3,414/92,488 ms; the drift smoke run submits its long horizon before
checking the alert, so that observation delay is not a push-channel latency SLA.
Alert-to-notification p50/p95 was 459/545 ms and alert-to-chain confirmation
12,231/12,699 ms (two excursions). Browser redraw timing was not measured.

Forecast limitations: this seeded history is exactly seasonally repeating. The
measured seasonal-naive MAPE/RMSE was zero and SARIMA approximately zero; those
numbers do not establish real demand accuracy, and residual-based prediction
intervals can collapse on this fixture. The seed's textual `productionStatus`
does not replace production/lab approval and release eligibility checks. Those
checks were preserved, not bypassed to manufacture a positive allocation result.

## Final detector measurements

Generated results are complete, not a shortened benchmark. Baseline class balance
is 61,800 samples: 38,940 injected-positive / 22,860 normal, including warm-up.
Each scenario has 12,360 samples; normal has zero positives, door-open/drift/
flatline each have 12,000, and repeated outbound/return GPS injections have
2,940. The artificial prevalence is not field prevalence; the JSON and Markdown
include reweighted 1%/5% estimates and per-run mean/sample SD.

Held-out observed sample FAR: AI 0.9828% (cutoff 1.0782122905), statistical edge
0.9951% (cutoff 1.8333333333). Calibration/evaluation seeds remain disjoint.

GPS-jump **pooled** benchmark results (includes each method's temperature flags,
not just its physical GPS sub-rule):

| Method | Precision | Recall | F1 | Normal-sample FAR |
|---|---:|---:|---:|---:|
| Threshold | Undefined (no positive predictions) | 0% | 0% | 0% |
| Edge comparator | 99.8302% | 100% | 99.9150% | 0.0531% |
| AI raw | 97.4801% | 100% | 98.7240% | 0.8068% |
| AI persisted | 99.5935% | 100% | 99.7963% | 0.1274% |

Baseline normal advisory episode starts/hour, mean ± sample SD:
raw **0.446602 ± 0.264782**, persisted **0.072816 ± 0.113129**.
Normal sample FAR: raw 0.8981%, persisted 0.2913%. Any false flag occurred in
30/30 raw normal runs and 10/30 persisted normal runs, each about 6.87 hours.
Episode counts are not the binary "run had any false flag" statistic.

Normal-run before/after sample FAR (%), independent seed sets:

| Setting | Method | Phase 10 | Phase 11 |
|---|---|---:|---:|
| 10-second sampling | Threshold | 0 | 0 |
| 10-second sampling | Edge comparator | 93.7702 | 0.0485 |
| 10-second sampling | AI raw | 70.1375 | 0.0081 |
| 10-second sampling | AI persisted | 78.4790 | 0 |
| Noise ×2 | Threshold | 50.1861 | 49.9191 |
| Noise ×2 | Edge comparator | 34.4903 | 33.7460 |
| Noise ×2 | AI raw | 46.9822 | 45.4935 |
| Noise ×2 | AI persisted | 46.8770 | 44.6764 |

**Limitations remain substantial.** All 35 method/condition pairs with FAR >10%
are listed individually in `results/ai_vs_threshold.md` and JSON. They occur in
noise ×1.5/×2 experiments across the five scenarios (negative warm-up samples
remain negative in injected profiles). These are not filtered out or retuned.
Noise expansion itself breaches the approved temperature band on many
injection-labelled normal samples; the threshold comparator must still flag
those values. It is not a policy-engine error.

The statistical edge comparator missed baseline door-open runs (recall 0),
because its relative-deviation score adapts and its calibrated hysteresis does
not encode an absolute policy breach. Deployed local policy checks and the
authoritative policy engine are separate and did detect door-open in acceptance.
The AI persisted baseline door-open F1 (mean 0.998) is slightly below threshold
F1 (1.000); persistence adds a mean 62-second first-flag delay.

Compressor drift: AI persisted first flag 220 ± 74.464 s, first threshold breach
2,004 ± 29.896 s, conditional positive lead 1,784 ± 77.085 s (all 30 runs had
pre-breach flags). Edge's 2,040 s positive lead is over **one** pre-breach run,
not all 30; its all-run mean first delay is 4,160 s. First-flag lead is not
continuous warning, a forecast of the breach, or correct compressor diagnosis:
the nondirectional score can flag the initial low-temperature shift before
warming and later return below cutoff. No causal/clinical forecasting claim is
made from these synthetic first-flag timings.

The GitHub workflow's stale `27018/rs0` backend-test connection was changed to
the same isolated `27019/rs-test` stack used by the successful native run. Its
test step stops live writers and its final cleanup removes both CI projects.
This workflow edit was inspected locally; a hosted GitHub Actions run is **not
verified**. The native suite uses mocks/unavailable-AI paths; actual AI calls are
verified separately by acceptance and the seeded detector experiment.
The workflow and both Compose YAML files parsed successfully using the installed
`yaml` library; this is syntax checking, not a hosted workflow execution.

The pre-normalization Phase 10 report (generated 2026-10-07T04:08:21.854Z,
`phase10-eval-*`) is preserved at
`results/history/ai_vs_threshold_phase10.json`. The Phase 11 evaluator captured
its normal/noise-times-two/10-second FAR values before regenerating current
results. This preserves provenance without recalibrating on evaluation seeds.

## Module audit and verification boundaries

Commands below were executed in this phase. "Working" means the stated local
synthetic check passed, not that every browser/deployment path is certified.
The full-suite totals and detector experiment are recorded in the execution
table; historical attempts are distinguished above.

| Module | Status | Current evidence (file:line) | Exact executed command and result | Remaining gap |
|---|---|---|---|---|
| Simulator | Working, synthetic | `backend/services/iotSimulator.js:263` | `node scripts/acceptance.js`; `node scripts/evaluate.js`: door-open/manual flow and six policy smoke scenarios passed | Scenario labels are injected intent, not independent clinical ground truth |
| Edge | Working within documented scope | `backend/edge-gateway/edgeMath.js:3`, `:65` | `node scripts/acceptance.js`: stored edge GPS flags and AI physical-speed reason passed; `node scripts/evaluate.js`: ordered recovery, zero loss/duplicates | Durable buffer needs Mongo; deployed local threshold differs from evaluation-only calibrated edge hysteresis |
| Ingestion | Working | `backend/services/telemetryService.js:50`, `telemetryValidation.js:59` | Full native Jest against isolated Compose Mongo; `node scripts/acceptance.js`: authenticated simulator/manual ingestion passed | Compatibility synchronous path remains; remote HTTPS/TLS not executed |
| Consumers/database | Working | `backend/worker.js:29`, `eventConsumers.js:47`, `eventBackbone.js:59` | `node scripts/acceptance.js`: queued alert processed while API stopped, then API recovered | Groups are separate loops in one worker; long-outage DLQ replay and production scaling not demonstrated |
| Policy alerts | Working | `backend/services/eventConsumers.js:64` | `node scripts/acceptance.js`: approved-policy excursion, reason, outbox and notifications passed | Approved demo limits are not clinical advice; AI cannot create/clear policy holds |
| AI advisory | Working API; research limitations | `ai-services/normal_detector.py:25`, `anomaly_detection.py` | `python -m pytest ai-services/tests -q`: 36 passed; `node scripts/acceptance.js`: computed GPS advisory stored without temperature alert | Synthetic original-only calibration; final per-condition false alarms must be consulted |
| Forecasting | Working on seeded fixture | `backend/routes/forecastRoutes.js:8`, `analyticsController.js:79` | `docker compose exec -T backend node scripts/phase11AnalyticsProof.js`; `node scripts/evaluate.js`: 35 complete months, SARIMA/baseline metrics returned | Exactly repeating seasonal fixture gives near-zero errors; no external forecast validation |
| Optimization | Partial live demonstration | `backend/controllers/analyticsController.js:102`, `:133` | `docker compose exec -T backend node scripts/phase11AnalyticsProof.js`: plan 201, approval 200, stock unchanged/no dispatch | Zero allocation: seeded batches unreleased. Positive live allocation not verified; constrained nonzero plans covered by tests |
| Blockchain | Working local integrity proof | `backend/services/merkleAnchoring.js:6`, `:80` | `node node_modules/hardhat/internal/cli/cli.js test`: 9 passed; `docker compose exec -T backend node scripts/liveMerkleChainProof.js`: live root/tamper/restore passed | Root proves integrity, not vaccine safety; local chain volatile, public chain not verified |
| Notifications | Working test capture | `backend/services/notificationDispatcher.js`, `emailOutbox.js` | `node scripts/acceptance.js`: in-app and actual Ethereal capture passed | Test mailbox only; real-recipient delivery not verified; preview links are private capabilities |
| Dashboards | Partial runtime/browser verification | `frontend/src/hooks/useDashboardRealtime.js:16`, `components/TelemetryHistoryChart.js:9` | Frontend test command: 38 suites/160 tests; field Vitest: 12 files/59 tests; acceptance returned alert and Manual chart history | Browser redraw latency, visual Chrome/Safari and camera behavior not verified |
| QR/verification | Working API + UI tests | `backend/routes/merkleVerificationRoutes.js:6`, `frontend/src/components/BatchVerificationQr.js` | `node scripts/acceptance.js`; live Merkle proof: anchored evidence and tamper rejection passed | Authenticated verification URL, not public unauthenticated QR scanning; live camera scan not verified |
| Manual entry | Working tested pipeline | `backend/routes/readingRoutes.js:7`, `:9` | Full Jest permissions/correction tests; `node scripts/acceptance.js`: manual 11 C → alert → notification → Merkle proof → labelled history passed | No physical sensor validity is established by manual provenance |
| Platform | Working local Compose | `docker-compose.yml`, `backend/server.js:92` | Clean down/build/up/seed; `docker compose exec -T backend node scripts/phase11ReadinessProof.js`: five logins and authenticated readiness passed | Worker heartbeat is readiness-only, not a Docker healthcheck; build reused cached dependency layers, not a no-cache clean-clone proof |
| CI | Not verified on hosted runner | `.github/workflows/ci.yml` | Workflow/Compose YAML parsed locally; equivalent isolated native Jest command passed | Hosted GitHub Actions was not executed; no hosted-green claim |

## Exact viva sequence

1. Docker Desktop must show a responding Engine; Node 20+ must be available.
   From the repository root run `node .\scripts\run-demo.js`.
2. Open `http://localhost:3000` in separate tabs, select the matching role and
   use the four `*@demo.synthetic.test` accounts in README. The field panel at
   `http://localhost:5173` has its own Field Operator login. All five use the
   private `.env` value `DEMO_SEED_PASSWORD`; do not project the password.
3. In Admin show system readiness, approved batch limits, synthetic provenance,
   inventory, forecast history and plan assumptions. Explain that unreleased
   seeded stock is correctly excluded and approval is review-only.
4. Use normal and door-open simulator profiles, or create a manual 11 C reading
   with a note for an approved batch. Keep policy alerts distinct from advisory
   explanations. Compare the same saved reading/alert in authorized role tabs.
5. Show notified roles and the captured Ethereal **test** email. Wait for the
   30-second demo Merkle window; distinguish pending from confirmed evidence.
6. Open the batch verification QR URL in the authenticated Healthcare tab;
   distinguish batch identity from sensor evidence. Use append-only corrections,
   never direct database edits, for user-facing correction demonstrations.
7. Run `node .\scripts\acceptance.js` for repeatable simulated/manual/API-restart
   proof, and `node .\scripts\evaluate.js` for the platform diagnostics. The
   scripts add uniquely named synthetic fixtures; they are not clinical data.
8. Present `results/ai_vs_threshold.md` per-scenario results and limitations;
   explain the disjoint seeds, physical GPS rule, raw/persisted false alarms and
   gateway-comparator difference. Do not present throughput or backfilled
   timestamps as field measurements.
9. Stop with `docker compose down` only when finished. Even without `-v`, stopping
   Hardhat loses its in-memory chain: a later seed alone cannot restore old roots.
