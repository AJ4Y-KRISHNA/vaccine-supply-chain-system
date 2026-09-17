# Explainable cold-chain monitoring and quality review

## Scope and evaluation findings

This is a software-only, single-backend-process prototype. No new package dependency, paid service, physical hardware, blockchain integration, or forecasting change is introduced by the cold-chain feature. It does not determine whether a vaccine is clinically safe to use.

The previous implementation had a deterministic simulator and basic temperature alerts, but magnitude-based severity, unrestricted resolution, and UI-only warnings did not satisfy the quality-review workflow. This extension replaces that behavior with approved, versioned batch policies, time-based excursions, telemetry-health checks, persistent holds, role-targeted notifications, and reviewed clearance. Existing working controllers remain behind safety guards rather than being rewritten.

## Implemented behavior

| Condition | Result | In-app recipients |
| --- | --- | --- |
| Temperature/humidity in policy, device evidence complete | Record normal telemetry; no new notification | None |
| Brief high/low excursion | `REVIEW_REQUIRED`, exact explanation, request another reading | Admin + owning manufacturer |
| Same-direction excursion reaches the approved duration, without an excessive reading gap | `QUARANTINED`, hold batch and all associated shipments, block dispatch/administration | Admin + manufacturer + assigned distributors + destination hospitals |
| Humidity outside the configured optional range | Review-required event | Admin + manufacturer |
| Missing reading, absent/critical battery, required humidity missing, implausible rate of change | `RELIABILITY_ISSUE`, explain missing/unreliable evidence; recommend device/simulation check | Admin + manufacturer |
| Normal readings after quarantine | Close the measured excursion, **retain quarantine** | No new normal-reading notification |
| Authorized reviewer records review, then explicitly clears | Remove this event's hold, retain other holds and original workflow state, append audit records | Relevant recipients above |

Humidity/reliability events do not automatically quarantine in v1; operators may quarantine manually. GPS is simulated context, not an independently verified location. Notification records are in-app only, not email/SMS. A shared role/organization notification's read flag is shared by that recipient group.

## Data and integration points

1. `iotSimulator.js` generates deterministic device, vehicle, batch, temperature, humidity, GPS, battery and timestamp data from a fixed seed/clock. Its configured range is only a generator setting.
2. `telemetryService.js` saves both simulator and existing `/api/temperature/ingest` readings into `TemperatureLog`, evaluates each reading, and stores `evaluation` alongside the existing `Normal`/`Alert` status.
3. `ColdChainPolicy` stores an approved immutable revision. `Batch.coldChainPolicyId` selects the revision. A policy contains temperature limits, optional paired humidity limits, excursion duration, maximum sample gap, battery threshold, rate plausibility threshold, source reference, approval reason, reviewer and approval timestamp. Fixed v1 action rules are stored in the revision too.
4. `TelemetryState` persists each batch/shipment/device's latest reading and continuous-excursion clock. State survives backend restarts even though simulator schedules do not.
5. `TemperatureAlert` (the anomaly-event model) stores policy snapshot, severity, confidence explanation, exact reasons, recommended action, affected IDs, humidity/battery/rate, vaccine type/shipment context, notification targets and quality-review metadata.
6. `Batch` and `Shipment` have `coldChainHoldAlertIds` and a visible `coldChainStatus` overlay. Their original workflow `status` is not overwritten. The last hold's removal restores the existing workflow eligibility rules; it is not an unconditional dispatch approval.
7. `Notification` is reused, with stage/role/recipient deduplication keys. The older broad order-notification queries exclude cold-chain notifications so they cannot expose targeted records.
8. `ColdChainAudit` stores append-only policy approvals, event opening/closure, acknowledge, quarantine, review and clearance records. Authorization is recorded before release mutations. Both event/simulation time and application recording time are retained.

No historical telemetry or legacy `Batch.temperaturePolicy` values are deleted or silently promoted into approved policies. The legacy policy PUT remains a draft-only operation. Existing `/api/temperature/*` paths, API-key requirement, optional fields, single/array input and array response shape remain; `evaluation` is additive. Unapproved readings explicitly report `POLICY_NOT_APPROVED`, not “safe.” Legacy client status is retained when no evaluation is possible; approved evaluation overrides it.

### Deterministic evaluation

- First abnormal sample: warning, duration zero. Equal-to-boundary values are in range.
- Later samples use their recorded timestamps, not elapsed wall time. Same-direction samples within the approved maximum gap accumulate duration. The threshold is inclusive (`duration >= excursionDurationMs`).
- Missing intervals, direction changes and policy revisions reset continuous-exposure evidence. The engine does not infer sustained exposure across an unobserved gap.
- Stale, conflicting or duplicate timestamps cannot roll state backward or clear a hold. Resetting the generator never clears database safety state.
- Confidence is `HIGH` or `LIMITED` evidence completeness, explicitly **not** a calibrated probability, an ML score, or a vaccine safety judgment.
- For a synthetic policy of 2–8°C and 18 minutes, continuous 10.8°C readings reproduce: “Critical: 10.8°C is 2.8°C above the approved maximum of 8°C for 18 consecutive measured minutes.” These numbers are test examples, not medical guidance.
- Accepted readings check other known streams at the same timestamp. To test complete silence, explicitly submit the advancing simulation clock to `/telemetry/check`. If no stream has ever reported, there is no last-reading baseline to evaluate. Pausing the entire simulation does not automatically advance time.

## Authorization and operational enforcement

All new safety routes validate the JWT and load the **current** User record. They do not trust a stale token's role/capability, and ignore the `AUTH_OPTIONAL` development bypass.

| Account | Access |
| --- | --- |
| Admin | All alerts, acknowledge/quarantine, inspect policies and telemetry clocks |
| Manufacturer | Same actions only for batches matching `User.manufacturer` (or email) to `Batch.manufacturer` |
| Designated admin/manufacturer with `canReviewColdChain: true` | Approve policies and review/clear, within the same ownership scope |
| Distributor | Read alerts/notifications addressed to `User.distributor` or email matching `Shipment.distributor` |
| Healthcare | Read alerts/notifications addressed to `User.hospital` or email matching `Shipment.destination` |

Identity comparisons are trimmed and case-insensitive. No reviewer capability is granted automatically. This is an application capability, not an assertion of real-world professional qualification.

Guards protect existing distribution creation/receive/verify/status/supply/confirmation routes; shipment creation; vaccination inventory/administer/report/workflow/create routes; manufacturer batch/workflow/report/release paths. Quarantined requests return **409 `COLD_CHAIN_HOLD` before the existing controller runs**, including before any existing blockchain call. Missing identity is 401; wrong role 403. Traceable operations now require an existing batch or matching existing shipment. Protected hold/policy fields cannot be set through generic request bodies. Generic batch creation rejects duplicate IDs.

Dispatch/administration guards and evaluation/clearance share a per-batch in-process queue. A hold check consults batch holds, shipment holds and alert review requirements, failing closed if a prior multi-document hold operation was only partially applied.

For clearance, all known streams must be fresh and in policy at the supplied `asOf` simulation clock, with no open excursion/reliability event. The reviewer records a reason and evidence snapshot, then clears with another explicit reason. Any new telemetry invalidates that review snapshot. Clearing one event never releases a different event's hold. The old `/resolve` URL delegates to this same guarded clearance, not an unrestricted status update.

## API

All routes below start with `/api/alerts` and require `Authorization: Bearer <JWT>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Scoped list; filters `status`, `severity`, `phase`, `batchId`, `shipmentId`, `deviceId`, `from`, `to`, `limit` (max 200) |
| GET | `/summary` | Counts across all matching history, recent events, current UI capabilities |
| GET | `/:alertId` | Event, append-only audit trail and latest evidence clock |
| PATCH | `/:alertId/acknowledge` | Acknowledge without releasing a hold |
| PATCH | `/:alertId/quarantine` | Manual precautionary hold; `{ "reason": "…" }` |
| PATCH | `/:alertId/review` | Reviewer records current evidence; `{ "reason": "…", "asOf": "ISO timestamp" }` |
| PATCH | `/:alertId/clear` | Reviewer clears after review, same body shape |
| PATCH | `/:alertId/resolve` | Compatibility alias for guarded `/clear` |
| GET | `/notifications` | Scoped application notification records |
| PATCH | `/notifications/:notificationId/read` | Mark an authorized recipient-group notification read |
| GET | `/policies/batch/:batchId` | Approved revision + legacy draft + policy status |
| PUT | `/policies/batch/:batchId` | Update legacy draft limits only |
| POST | `/policies/batch/:batchId/approve` | Reviewer approves a complete policy revision |
| POST | `/telemetry/check` | `{ "batchId": "…", "asOf": "ISO timestamp" }`; check known sensors for missing readings |

Policy approval rejects active excursions/holds rather than changing thresholds underneath an incident. See [IOT_SIMULATOR.md](IOT_SIMULATOR.md) for the simulator lifecycle and scenario-switch API.

## Step-by-step local demonstration

1. Start local MongoDB. In the existing backend environment configure `MONGO_URI`, a non-default `JWT_SECRET`, and `TEMP_API_KEY`. Start the backend with `npm start` (or `node server.js`) from `backend`; start the frontend with `npm start` from `frontend`. No paid service is required.
2. Use existing accounts and batch/shipment workflows. Ensure the chosen shipment belongs to the batch and that organization identity mappings above are populated. Do not use a real clinical batch for a synthetic demo.
3. Explicitly designate one existing admin/manufacturer as the project quality reviewer. From `backend`, the local project operator can run:

   ```powershell
   node scripts/setColdChainReviewer.js "reviewer@example.test" grant "project-owner" "Designated reviewer for the synthetic demo"
   ```

   Replace the email with an actual existing account. The script requires exactly one eligible account, audits the authorization, and changes only `canReviewColdChain`. Use `revoke` instead of `grant` to revoke it. Reviewer access is never granted automatically on server startup. The later user-authorized setup and completed synthetic run are recorded in [COLD_CHAIN_DEMO_RESULT.md](COLD_CHAIN_DEMO_RESULT.md).
4. Log in as that reviewer. In the Admin/Manufacturer dashboard open **Batch storage policy and simulation clock**, enter the real demo batch ID, and approve a policy with its source/reference and reason. For a purely synthetic test fixture only, an API request can use:

   ```json
   {
     "minimumTemperature": 2,
     "maximumTemperature": 8,
     "minimumHumidity": 40,
     "maximumHumidity": 80,
     "excursionDurationMs": 120000,
     "maximumReadingGapMs": 90000,
     "criticalBatteryPercent": 10,
     "maximumRateCelsiusPerMinute": 100,
     "sourceReference": "Synthetic demonstration fixture — NOT an approved medical policy",
     "approvalReason": "Local software workflow demonstration only"
   }
   ```

   Send it to `POST /api/alerts/policies/batch/<BATCH_ID>/approve`. Real product limits must be supplied by the appropriate approved product/storage policy and authorized reviewer; never reuse the fixture as a medical rule.
5. Create a device at `POST /api/simulator/devices` with the real batch/shipment IDs, `scenario: "HIGH_TEMPERATURE"`, a fixed seed, `startTime: "2026-01-01T00:00:00.000Z"`, `tickIntervalMs: 60000`, and generator `temperatureRange: { "min": 2, "max": 8 }` for this synthetic fixture.
6. Manually call `POST /api/simulator/<DEVICE_ID>/tick` three times. They represent minute 0, 1 and 2 even when requests are made immediately. First tick produces review-required notifications; the third crosses the fixture's duration threshold and quarantines. Refresh the dashboard and inspect exact reasons, source policy, context, targets and audit history.
7. Verify that dispatch and administration requests fail with 409. Check the assigned distributor/hospital dashboards: they see quarantine, while unrelated organizations do not receive this alert through the alerts API.
8. Switch the device using `POST /api/simulator/<DEVICE_ID>/scenario` with `{ "scenario": "NORMAL" }`. This stops scheduling and preserves the advancing clock. Tick once at minute 3. The measured excursion closes, but the hold remains.
9. As reviewer, choose **Record quality review**, inspect the full evidence, and supply a reason. Then choose **Clear after review** with a reason. Keep the evidence clock current. If new readings arrive in between, review again. Existing operational eligibility is restored only after all batch holds are cleared.
10. For missing telemetry, stop the device and use **Check missing telemetry** with an `asOf` timestamp beyond the approved gap. For a low-battery case, create a separate test device/batch using a low `initialBatteryLevel` or `BATTERY_DRAIN`. Use separate batches for independent tests so an intentionally abandoned sensor does not block an unrelated demo's clearance.

Simulator controls currently have frontend API helpers but no dedicated device-management screen. Quality-policy setup, missing-clock checks, alert actions and audit history are available in the shared dashboard panel. Dashboards refresh on load, actions or manual **Refresh**; there is no push channel in this version.

## Verification

Verified in this workspace: **46 backend tests across 7 suites; 15 frontend tests across 4 suites; production build successful.** The build reports non-blocking existing Node deprecation/Browserslist-data warnings.

Backend: `npm test` from `backend`, or `node node_modules/jest/bin/jest.js --runInBand` with `NODE_ENV=test`. New integration suites use randomly named `codex_cc_test_*` databases on `MONGO_TEST_URI` (default local MongoDB), never the application's `MONGO_URI`, and remove only their own generated database after testing. The pre-existing dashboard suite is read-only; point `MONGO_URI` at a test database when running it.

Frontend: `npm test -- --watchAll=false --runInBand`, then `npm run build`, from `frontend`. Direct equivalents are `node node_modules/react-scripts/scripts/test.js --watchAll=false --runInBand` and `node node_modules/react-scripts/scripts/build.js`.

Coverage includes deterministic seeds/clocks and all five scenarios; GPS endpoint/reversal; retry/busy/reset behavior; normal/brief/sustained high/low; exact 18-minute explanation; missing/late/duplicate readings; humidity/battery/rate; no approved policy; raw ingestion compatibility; recipient isolation; review/evidence freshness; independent holds; append-only model enforcement; operational bypass attempts; policy validation; and dashboard actions. The production build has been verified successfully under the supplied Node 24 runtime; the earlier unverified stall diagnosis no longer applies.

## Prototype limits and recommended next steps

1. **Not clinical production software.** No automatic destruction/disposal instruction, vaccine release decision, or validated learned model is supplied. Human-approved policy and qualified review remain required.
2. **Single backend instance only.** The lock is in-process, not distributed. MongoDB hold/audit/notification writes are not one transaction. Authorization-before-release records and redundant hold checks reduce partial-write risks, but replica-set transactions plus a durable notification outbox/reconciliation worker are needed before multi-instance deployment or claims of exactly-once processing.
3. **Application-level append-only, not absolute database immutability.** Audit/policy models reject edits and deletes, including bulk modifications. A database administrator or direct collection client can still bypass application hooks. A production deployment needs restricted database credentials, independent immutable storage/backups and a tamper-evidence design. No blockchain changes were made.
4. **Simulator state is in memory.** Persisting device configurations/jobs, explicit expected-device registration/retirement, paginated queues and pushed updates are useful next improvements. Historical raw logs can duplicate after partial write/retry; stale data never rewinds alert state.
5. **Legacy system boundaries remain.** This adds scoped cold-chain APIs and mutation safety guards, not a full security rewrite of every existing dashboard, order or historical-data endpoint. Old unversioned active alerts require an explicit data-review/migration plan before approving policy for those same batches; they are not silently cleared.
6. **Future learned model stays advisory.** Evaluate a learned anomaly score only after collecting labeled synthetic scenarios and measuring false positives/negatives. Retain these deterministic rules, policy snapshots, explanations and reviewed quarantine as the baseline.
