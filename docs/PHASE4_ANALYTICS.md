# Phase 4 — Synthetic analytics

## Scope

Software-based synthetic demonstration, not clinical or production validation. Approved batch policies remain authoritative. Existing baseline forecast POST and pending-order supply planner remain available.

## Anomaly explanations

`ai-services/anomaly_detection.py` retains the additive score and numeric `feature_contributions` map used by the event consumer. It adds `label` and `contributions`, a list containing feature, numeric contribution and plain-English text. Temperature and humidity explain deviation, median, sample count and threshold. Timestamped temperature samples in the preceding 30 minutes provide an additional mean/deviation explanation, explicitly stating how many samples are available. The fitted trend reports °C/min. Missing history yields an unavailable conclusion, not an invented score. This statistical explanation is not SHAP, a trained failure classifier or a safety probability.

## Regional forecasts

- `GET /api/forecast` returns authorized synthetic vaccine/region catalog; add `vaccineType`, `region`, `horizon=3..6` to generate and save a forecast.
- Only orders marked `isDemo` are included. Manufacturer history uses explicit historical `Order.manufacturer` ownership, without inventing physical batch allocation. Healthcare keeps organization scope; Admin can see all synthetic history.
- At least 30 observed complete UTC months are needed. Missing months between the first observed month and last complete month represent zero recorded demand, disclosed in provenance. The current incomplete month is excluded. The existing 36-month seed therefore supplies 35 complete months.
- Compare seasonal-naive-12 with fixed SARIMA(1,0,0)(0,1,1,12), bounded 100-iteration L-BFGS and 300-iteration Powell retry. Failed/non-finite fits are reported as unavailable; seasonal baseline remains available.
- Last six months form the chronological holdout. Select by holdout RMSE and refit on all history. MAPE excludes zero actual months and records their count. Selection and reported metrics share the same holdout, so these are not independent thesis validation metrics.
- SARIMA supplies model-based 95% prediction intervals. Baseline intervals use seasonal residual RMS × 1.96, an approximate normal-error interval. These are prediction intervals rather than confidence bounds on the mean, and are not guarantees.
- Append-only `ForecastRun` stores results, provenance and comparisons. `GET /api/forecast/:id/metrics` downloads account-scoped JSON. Every run also exports JSON into `ANALYTICS_METRICS_DIR` (default `backend/data/analytics`; persistent `analytics-artifacts` volume in Compose). Exports contain no authentication secrets.

## Supply recommendation and approval

Admin uses `POST /api/admin/forecast-plan` with saved `runIds`, `destinationCapacity`, `transportCapacity`, and `minimumShelfLifeDays`. The UI generates one selected product/region plan; the API accepts up to 30 distinct product/region runs from the same account/month. Forecasts and plans expire after 24 hours or when their target month becomes past.

The first forecast month is planned (the current month on a fresh run). Synthetic batches must pass the existing release/ownership/hold/stock accounting eligibility checks. Expiry must exceed the later of now or target-month start plus the specified shelf-life days. Unknown expiry is excluded. Arrival is assumed immediate in the target month; this is not a route/transit optimizer.

SciPy HiGHS maximizes fulfilled doses under product, batch stock, shared regional capacity and total transport capacity. Results are projected to whole doses and checked against hard constraints; a deterministic greedy pass fills residual capacity or provides fallback on solver failure. No claim of globally optimal integer/FEFO allocation is made. Inputs, allocations, exclusions and assumptions are saved in the existing append-only `SupplyPlan`.

`POST /api/admin/forecast-plan/:id/approve` requires authenticated Admin ownership, a 10–1000-character review reason, a current plan and an unchanged inventory fingerprint. An append-only, unique `ForecastPlanApproval` records review. Approval does **not** change stock, create orders, reserve inventory or dispatch. Physical allocation still requires the existing authorized order workflow. A subsequent stock change invalidates the plan for new approval.

Fresh seed batches are not release-approved. Zero recommendations with `BATCH_NOT_RELEASED` are correct; use the existing production/lab signing and reporting workflow before demonstrating nonzero allocation. Analytics does not bypass those gates.

## UI

Existing installations seeded before Phase 4 can run `docker compose exec -T backend node scripts/backfillSyntheticDemandOwners.js` after rebuilding the backend. This updates only missing manufacturer ownership on the exact marked seed order fixtures; it does not reseed, reset passwords or alter stock. New seeds already include ownership.

Admin and Manufacturer dashboards mount `ForecastAnalyticsPanel`: vaccine/region selection, 3/6-month horizon, synthetic provenance text, history/forecast/95% band chart, model metrics and thesis JSON download. Admin additionally enters capacities and shelf life, computes a recommendation, reviews exclusions/assumptions and records explicit approval.

## Verification

From repository root, using an installed Node/Python environment:

```powershell
$env:PYTHON_EXECUTABLE = (Resolve-Path '.\ai-services\venv\Scripts\python.exe').Path
$env:ACCEPTANCE_MONGO_URI = 'mongodb://127.0.0.1:27018/?directConnection=true'
node .\backend\scripts\runAnalyticsAcceptance.js --execute
```

This runs the actual seed in a disposable database, logs in all four roles, calls the real Python model/solver APIs, checks saved metrics, verifies Admin approval without stock mutation, and removes only its test database. JSON exports remain in `backend/data/analytics/phase4-acceptance`. Add `--preview` after building the frontend with `REACT_APP_API_BASE=/api` to inspect the seeded UI; use its printed disposable credentials, then send `exit` to clean up.

`runSystemAcceptance.js` also invokes `verifyPhase4Analytics.js` after the existing full shipment/alert/chain workflow. Unit tests cover numeric explanations, genuine SARIMA evaluation, intervals, fallback, solver constraints, scope, JSON exports, approval, stale inventory and UI controls.

## Verified results (2026-10-06)

- Backend: 53 suites / 318 tests passed. An existing simulator timing test failed during the first concurrent build/test run, then passed independently and on two full-suite reruns; its application code was not changed for Phase 4.
- Frontend: 34 suites / 145 tests passed. Existing dashboard workflow tests now isolate the new analytics child, which has separate chart/provenance, manual-capacity/approval, retry and JSON-download unit tests.
- AI: 26 tests passed. Host production frontend build passed; existing broad shipment/alert/local-chain acceptance passed 64 HTTP calls, including the analytics extension.
- Actual fresh-seed acceptance passed all four logins, real SARIMA/baseline comparison, stored JSON metrics, three synthetic product histories, review without stock mutation, and a 40-dose allocation from an explicitly released isolated fixture under a 40-dose transport limit. The fixture retains 90 stock doses after recommendation approval.
- In-app browser: Admin six-month forecast chart, exclusions, recommendation and review-success state; Manufacturer three-month chart, synthetic provenance and absence of Admin planning controls were observed through browser automation guided by the computer-use skill.
- Open verification boundary: the in-app browser download-event check timed out. The account-scoped export endpoint, retained JSON file and download-button unit test passed, but an actual in-app-browser file download is not claimed. Chrome/Safari-specific testing was not performed.
- Docker deployment: rebuilt AI, backend and frontend images were applied; all nine Compose services reported healthy. The compatibility migration updated 108 marked synthetic seed orders. Admin and Manufacturer logins each returned three ready vaccine/region histories, real three-month forecasts with evaluated SARIMA comparison, and HTTP 200 metrics exports saved in the persistent analytics volume. No stock or password changes were made by this migration.

The retained thesis sample is `backend/data/analytics/phase4-acceptance/6ac3f7c85630146d07cbf490.json` (ignored runtime artifact, not committed). It includes exact MAPE/RMSE, provenance, chronological history, SHA-256, prediction intervals and library versions. The seasonal seed repeats exactly, so its zero seasonal-baseline error must not be presented as real-world forecasting performance.

## Dependency rationale

- `statsmodels` supplies the established SARIMA implementation.
- `scipy` supplies the established linear-programming solver; declared explicitly even though statsmodels also depends on it.

Both are declared in AI requirements and the lightweight AI Dockerfile; experimental TensorFlow/BERT dependencies are not added to the demo image.
