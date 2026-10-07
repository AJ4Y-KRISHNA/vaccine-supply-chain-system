# Explainable cold-chain monitoring and quality review

## Scope and evaluation findings

This is a software-only, single-backend-process prototype. It uses synthetic telemetry, no physical hardware, and no clinical safety determination. A separate optional local worker stores batch-linked raw sensor readings in the local contract with a SHA-256 commitment and anchors hashes of persisted cold-chain audit evidence. MongoDB remains the application's primary read/query source.

The previous implementation had a deterministic simulator and basic temperature alerts, but magnitude-based severity, unrestricted resolution, and UI-only warnings did not satisfy the quality-review workflow. This extension replaces that behavior with approved, versioned batch policies, time-based excursions, telemetry-health checks, persistent holds, role-targeted notifications, and reviewed clearance. Existing working controllers remain behind safety guards rather than being rewritten.

## Implemented behavior

| Condition | Result | In-app recipients |
| --- | --- | --- |
| Temperature/humidity in policy, device evidence complete | Record normal telemetry; no new notification | None |
| Brief high/low excursion | `REVIEW_REQUIRED`, exact explanation, request another reading | Admin + owning manufacturer + assigned distributor + destination hospital (informational) |
| Same-direction excursion reaches the approved duration, without an excessive reading gap | `QUARANTINED`, hold batch and all associated shipments, block dispatch/administration | Admin + manufacturer + assigned distributors + destination hospitals |
| Brief humidity below/above configured limits | `LOW_HUMIDITY` / `HIGH_HUMIDITY`, `REVIEW_REQUIRED`, exact explanation, request another reading | Admin + owning manufacturer + assigned distributor + destination hospital (informational) |
| Same-direction humidity excursion reaches the policy's `excursionDurationMs`, without an excessive reading gap | `LOW_HUMIDITY` / `HIGH_HUMIDITY`, `QUARANTINED`, hold batch and associated shipments pending quality review | Admin + manufacturer + assigned distributors + destination hospitals |
| Missing reading, absent/critical battery, required humidity missing, implausible rate of change | `RELIABILITY_ISSUE`, explain missing/unreliable evidence; recommend device/simulation check | Admin + manufacturer |
| Normal readings after quarantine | Close the measured excursion, **retain quarantine** | No new normal-reading notification |
| Authorized reviewer records review, then explicitly clears | Remove this event's hold, retain other holds and original workflow state, append audit records | Relevant recipients above |

Humidity checks are enabled only when both optional humidity limits are present in the approved policy. Older revisions without either limit remain valid and skip humidity excursion checks; no universal default is applied. Humidity uses the same `excursionDurationMs` and `maximumReadingGapMs` values as temperature. A brief event requests another reading; a sustained event follows the existing sustained-excursion quarantine path. A quarantine hold remains until an authorized reviewer clears it. GPS is simulated context, not an independently verified location. In-app notification records are always created; optional alert email delivery is described in [ALERT_EMAIL_DELIVERY.md](ALERT_EMAIL_DELIVERY.md). A shared role/organization notification's read flag is shared by that recipient group.

## Data and integration points

1. `iotSimulator.js` generates deterministic device, vehicle, batch, temperature, humidity, GPS, battery and timestamp data from a fixed seed/clock. Its configured range is only a generator setting.
2. `telemetryService.js` saves both simulator and existing `/api/temperature/ingest` readings into `TemperatureLog`, evaluates each reading, and stores `evaluation` alongside the existing `Normal`/`Alert` status.
3. `ColdChainPolicy` stores an approved immutable revision. `Batch.coldChainPolicyId` selects the revision. A policy contains temperature limits, optional paired `minimumHumidity` / `maximumHumidity` limits, excursion duration, maximum sample gap, battery threshold, rate plausibility threshold, source reference, approval reason, reviewer and approval timestamp. Humidity fields remain optional for earlier revisions; humidity checks are skipped unless both limits are present. Fixed v1 action rules are stored in the revision too.
4. `TelemetryState` persists each batch/shipment/device's latest reading and continuous-excursion clock. State survives backend restarts even though simulator schedules do not.
5. `TemperatureAlert` (the anomaly-event model) stores policy snapshot, severity, confidence explanation, exact reasons, recommended action, affected IDs, vaccine type, the measured temperature/humidity reading, the breached metric/limit, excursion duration, battery/rate, shipment context, notification targets and quality-review metadata.
6. `Batch` and `Shipment` have `coldChainHoldAlertIds` and a visible `coldChainStatus` overlay. Their original workflow `status` is not overwritten. The last hold's removal restores the existing workflow eligibility rules; it is not an unconditional dispatch approval.
7. `Notification` is reused, with stage/role/recipient deduplication keys. Every policy alert stage routes to the admin, the owning manufacturer, and only the distributor and destination on the alert's matching shipment. The in-app message and metadata include shipment/batch/vaccine, metric and breached limit, current reading, measured duration, source, recommendation and a role-scoped Batch Story deep link. The older broad order-notification queries exclude cold-chain notifications so they cannot expose targeted records.
8. `ColdChainAudit` stores append-only policy approvals, event opening/closure, response acknowledgement/action/resolution, quarantine, review and clearance records. Authorization is recorded before release mutations. Both event/simulation time and application recording time are retained.

No historical telemetry or legacy `Batch.temperaturePolicy` values are deleted or silently promoted into approved policies. The legacy policy PUT remains a draft-only operation. Existing `/api/temperature/*` paths, API-key requirement, optional fields, single/array input and array response shape remain; `evaluation` is additive. Unapproved readings explicitly report `POLICY_NOT_APPROVED`, not “safe.” Legacy client status is retained when no evaluation is possible; approved evaluation overrides it.

### Deterministic evaluation

- First abnormal temperature or humidity sample: warning, duration zero. Equal-to-boundary values are in range.
- Later samples use their recorded timestamps, not elapsed wall time. Same-direction temperature or humidity samples within the approved maximum gap accumulate duration independently. Both use the approved policy threshold inclusively (`duration >= excursionDurationMs`).
- Missing intervals, direction changes and policy revisions reset continuous-exposure evidence. The engine does not infer sustained exposure across an unobserved gap.
- Stale, conflicting or duplicate timestamps cannot roll state backward or clear a hold. Resetting the generator never clears database safety state.
- Confidence is `HIGH` or `LIMITED` evidence completeness, explicitly **not** a calibrated probability, an ML score, or a vaccine safety judgment.
- For a synthetic policy of 2–8°C and 18 minutes, continuous 10.8°C readings reproduce: “Critical: 10.8°C is 2.8°C above the approved maximum of 8°C for 18 consecutive measured minutes.” These numbers are test examples, not medical guidance.
- Accepted readings check other known streams at the same timestamp. Complete silence can be checked manually with `/telemetry/check` or with the opt-in simulator monitor. An armed monitor records an explicit expected-first-reading baseline (not a fabricated measurement), advances its anchored simulation clock with wall time, and checks every five seconds. Stop/reset does not disarm it. Historical late readings cannot roll the evidence clock backward. See the simulator guide for recovery and pause behavior.

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

### Alert response, routing and simulated escalation

Policy alerts produce in-app notifications at both the brief-review stage and quarantine/recovery stages. When alert email delivery is enabled, individual emails are also queued for active admin accounts and the owning manufacturer's matching accounts. Distributor and healthcare recipients continue to receive in-app notices only. Admin accounts can see all alert records. Manufacturer accounts see only alerts owned by their organization. An assigned distributor receives the record only when its identity matches `Shipment.distributor`; the destination hospital is included as an informational recipient only when it matches `Shipment.destination`. Routing is based on the single shipment named by the alert, not every shipment sharing its batch. When no matching shipment is attached, there is no downstream organization recipient.

The response state is distinct from policy-event status. The policy engine may close a recovered warning excursion while the human response remains open. Operator transitions are `OPEN → ACKNOWLEDGED → ACTION_TAKEN → RESOLVED`; acknowledgement and action require a note. `ACTION_TAKEN` is one of `inspect`, `reroute`, `hold`, or `discard-review`. `hold` invokes the existing quarantine operation. A reviewer must still record a current-evidence quality review before clearing or resolving. Clear requires a subsequent note and current simulation-clock evidence. Invalid order returns HTTP 409. Every response transition stores the actor and simulation event time on the alert and an append-only `ColdChainAudit` entry with its required note. The application recording time is retained separately. A normal reading closes the measured excursion only; it never automatically releases an existing hold.

Escalation is a computed flag, not a wall-clock job or outbound message. By default an open, unacknowledged alert is marked `Escalated` after **5 simulated minutes** from `excursionStartedAt`. Configure `COLD_CHAIN_ALERT_ESCALATION_AFTER_MS` in the backend environment to a positive millisecond value; values above seven days are capped and invalid/non-positive values use the 5-minute default. The comparison uses the latest matching shipment/device `TelemetryState.checkedAt` or `lastReadingAt`, with the alert's latest reading as a fallback. Therefore a stopped simulator clock does not escalate just because real time passed. Dashboard polling displays the computed flag after its next refresh.

Alert records and notifications include the assigned shipment/batch/vaccine, breached metric and limit, current reading, measured excursion duration, sensor source (`Automatic simulator`, `Manual sensor override`, or `Temperature ingestion`), recommended action, notification targets and a role-scoped deep link to the `shipment-journey` section of Batch Story. The link includes the batch ID and preselects that batch in the picker. In-app delivery is independent of email-provider availability.

Guards protect existing distribution creation/receive/verify/status/supply/confirmation routes; shipment creation; vaccination inventory/administer/report/workflow/create routes; manufacturer batch/workflow/report/release paths. Quarantined requests return **409 `COLD_CHAIN_HOLD` before the existing controller runs**, including before any existing blockchain call. Missing identity is 401; wrong role 403. Traceable operations now require an existing batch or matching existing shipment. Protected hold/policy fields cannot be set through generic request bodies. Generic batch creation rejects duplicate IDs.

Dispatch/administration guards and evaluation/clearance share a per-batch in-process queue. A hold check consults batch holds, shipment holds and alert review requirements, failing closed if a prior multi-document hold operation was only partially applied.

For clearance, all known streams must be fresh and in policy at the supplied `asOf` simulation clock, with no open excursion/reliability event. The reviewer records a reason and evidence snapshot, then clears with another explicit reason. Any new telemetry invalidates that review snapshot. Clearing one event never releases a different event's hold. The old `/resolve` URL delegates to this same guarded clearance, not an unrestricted status update.

## API

All routes below start with `/api/alerts` and require `Authorization: Bearer <JWT>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Scoped list; filters `status`, `responseState`, `severity`, `phase`, `batchId`, `shipmentId`, `deviceId`, `from`, `to`, `limit` (max 200); response adds computed `escalated`, threshold and Batch Story deep link |
| GET | `/summary` | Counts matching unresolved response states (`OPEN`, `ACKNOWLEDGED`, `ACTION_TAKEN`), resolved responses, recent events and current UI capabilities |
| GET | `/:alertId` | Event, append-only audit trail and latest evidence clock |
| PATCH | `/:alertId/acknowledge` | `OPEN → ACKNOWLEDGED`; `{ "reason": "required note" }` |
| PATCH | `/:alertId/action-taken` | `ACKNOWLEDGED → ACTION_TAKEN`; `{ "action": "inspect\|reroute\|hold\|discard-review", "reason": "required note" }` |
| PATCH | `/:alertId/quarantine` | Compatibility manual hold; requires prior acknowledgement and records `ACTION_TAKEN: hold`; `{ "reason": "…" }` |
| PATCH | `/:alertId/review` | Reviewer records current evidence after an action; `{ "reason": "…", "asOf": "ISO timestamp" }` |
| PATCH | `/:alertId/clear` | Reviewer clears after action and review, with a required reason and the same `asOf` evidence shape |
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
6. Manually call `POST /api/simulator/<DEVICE_ID>/tick` three times. They represent minute 0, 1 and 2 even when requests are made immediately. First tick produces review-required notifications; the third crosses the fixture's duration threshold and quarantines. Refresh the dashboard and inspect exact reasons, source policy, context, targets and audit history. As an admin/manufacturer operator, acknowledge the alert with a note and record an action such as `inspect` before requesting review.
7. Verify that dispatch and administration requests fail with 409. Check the assigned distributor/hospital dashboards: they see quarantine, while unrelated organizations do not receive this alert through the alerts API.
8. Switch the device using `POST /api/simulator/<DEVICE_ID>/scenario` with `{ "scenario": "NORMAL" }`. This stops scheduling and preserves the advancing clock. Tick once at minute 3. The measured excursion closes, but the hold remains.
9. As reviewer, choose **Record quality review**, inspect the full evidence, and supply a reason. Then choose **Clear after review** with a reason. Keep the evidence clock current. If new readings arrive in between, review again. Existing operational eligibility is restored only after all batch holds are cleared.
10. For missing telemetry, stop the device and use **Check missing telemetry** with an `asOf` timestamp beyond the approved gap. For a low-battery case, create a separate test device/batch using a low `initialBatteryLevel` or `BATTERY_DRAIN`. Use separate batches for independent tests so an intentionally abandoned sensor does not block an unrelated demo's clearance.

Simulator controls currently have frontend API helpers but no dedicated device-management screen. Quality-policy setup, missing-clock checks, alert actions and audit history are available in the shared dashboard panel. Dashboards refresh on load, actions or manual **Refresh**; there is no push channel in this version.

## Verification

Verified in this workspace after the alert-response changes: **191 backend tests across 24 suites; 103 frontend tests across 25 suites; production build successful.** The build reports non-blocking existing Node deprecation/Browserslist-data warnings.

Backend: `npm test` from `backend`, or `node node_modules/jest/bin/jest.js --runInBand` with `NODE_ENV=test`. New integration suites use randomly named `codex_cc_test_*` databases on `MONGO_TEST_URI` (default local MongoDB), never the application's `MONGO_URI`, and remove only their own generated database after testing. The pre-existing dashboard suite is read-only; point `MONGO_URI` at a test database when running it.

Frontend: `npm test -- --watchAll=false --runInBand`, then `npm run build`, from `frontend`. Direct equivalents are `node node_modules/react-scripts/scripts/test.js --watchAll=false --runInBand` and `node node_modules/react-scripts/scripts/build.js`.

Coverage includes deterministic seeds/clocks and all five scenarios; GPS endpoint/reversal; retry/busy/reset behavior; normal/brief/sustained high/low temperature; brief low/high humidity; sustained low-humidity quarantine; in-range humidity; legacy policies with no humidity limits; exact 18-minute temperature explanation; missing/late/duplicate readings; battery/rate; no approved policy; raw ingestion compatibility; recipient isolation for admin/manufacturer/assigned distributor/destination hospital; manual-override source labeling; ordered response transitions and invalid-transition rejection; required resolution notes; append-only response audit entries; simulated-time escalation; review/evidence freshness; independent holds; append-only model enforcement; operational bypass attempts; policy validation; and dashboard actions. The production build has been verified successfully under the supplied Node 24 runtime; the earlier unverified stall diagnosis no longer applies.

## Prototype limits and recommended next steps

1. **Not clinical production software.** No automatic destruction/disposal instruction, vaccine release decision, or validated learned model is supplied. Human-approved policy and qualified review remain required.
2. **Single backend instance only.** The lock is in-process, not distributed. MongoDB hold/audit/notification writes are not one transaction. Authorization-before-release records and redundant hold checks reduce partial-write risks, but replica-set transactions plus a durable notification outbox/reconciliation worker are needed before multi-instance deployment or claims of exactly-once processing.
3. **Local-chain evidence is not a public immutable ledger.** Audit/policy models reject edits and deletes, including bulk modifications. A database administrator or direct collection client can still bypass application hooks. Optional local Hardhat anchoring stores raw sensor readings plus a field commitment, and digest anchors for MongoDB readings and audit events. It can reveal mismatches if the local chain and its state are preserved, but the developer chain is centrally operated and ephemeral. A production deployment needs restricted database credentials, independently preserved immutable storage/backups and a separately operated tamper-evidence design.
4. **Simulator state is in memory.** Persisting device configurations/jobs, explicit expected-device registration/retirement, paginated queues and pushed updates are useful next improvements. Historical raw logs can duplicate after partial write/retry; stale data never rewinds alert state.
5. **Legacy system boundaries remain.** This adds scoped cold-chain APIs and mutation safety guards, not a full security rewrite of every existing dashboard, order or historical-data endpoint. Old unversioned active alerts require an explicit data-review/migration plan before approving policy for those same batches; they are not silently cleared.
6. **Statistical inference stays advisory.** A rolling median/MAD detector now compares readings with up to 30 prior same-batch/device readings, excludes prior model-flagged outliers from the next baseline, and stores its reason separately from policy evaluation. It is not trained on labeled failures and never creates or clears a quality hold. Any future learned anomaly model should also remain advisory until synthetic false-positive/negative behavior is measured; retain the approved policy rules, snapshots, explanations and reviewed quarantine as the safety workflow.
