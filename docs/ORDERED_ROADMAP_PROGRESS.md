# Ordered implementation progress

Date: 2026-09-17. This tracks the ten recommendations in section 13 of the project audit. It is not a claim that the full research framework is complete.

| Step | State | Evidence / remaining work |
| --- | --- | --- |
| 1. Checkpoint the prototype | Complete | Local branch `codex/ordered-roadmap-20260917`; checkpoint `2425396`. Existing cold-chain work retained. Environment files, dependency folders and generated artifacts excluded. Not pushed. |
| 2. Repair batch–shipment–order relationships | Complete for user-confirmed demo data | 62 journaled operations; 13 synthetic placeholder batches; all seven integrity checks now zero; retry plans zero changes. Original values retained, no deletions or quality approvals. |
| 3. Harden authentication and authorization | Local prototype hardening implemented | Password migration, required random secrets, no bypass/role-only login, DB-backed JWT identity, role and organization checks, scoped legacy reads, login throttling, body limits and local-only listener. 91 backend + 20 frontend tests passed at this checkpoint. Not a production security certification. |
| 4. Simulator UI and durable operation | Complete for single-process prototype | Admin/manufacturer controls, scoped selectors, exact durable RNG/clock/pending-reading checkpoints, stopped restart recovery and runtime authorization. |
| 5. Operational monitoring | Complete for opt-in simulated clocks | Five-second silence watchdog, explicit expected-first-reading baseline, persisted clock anchors and five-second dashboard refresh. In-app notifications only; no real hardware-health claim. |
| 6. Secure local blockchain integration | Pending | Contract/oracle access-control fixes, contract tests and cold-chain hash anchoring remain. |
| 7. Validate forecasting | Pending | Forecast window, dataset provenance, reproducibility, baseline comparisons and backtests remain. |
| 8. Constrained supply allocation | Pending | Step 2 supplies basic single-batch allocation accounting, not an optimizer. Expiry, capacity, multi-destination allocation and validated demand inputs remain. |
| 9. Full acceptance scenario | Pending | Previous cold-chain-only synthetic demo remains available. No claim of a full live-chain/AI end-to-end run. |
| 10. Research evaluation | Pending | Full-system metrics and research results cannot be asserted before the preceding work. |

## Step 2: implemented behavior

- `Order.auditBatchId` is preserved as a historical order audit reference. It is no longer used as a physical shipment batch ID on new approvals.
- Admin approval requires explicit `batchId` and `distributor` inputs. The batch must exist uniquely, match the ordered product, have mapped manufacturer ownership, satisfy existing production/lab/report release flags, and have no batch/shipment/alert quality hold.
- Optional `Order.allocatedBatchId`, `Order.shipmentId`, `Order.distributor`, and `Shipment.orderId` connect the records. Existing data is not overwritten.
- Every existing shipment counts against a batch's quantity. Unknown quantities, over-allocation and ambiguous references fail closed. Free-text cancellation statuses do not automatically return stock.
- Unreconciled shipments of the same product block new allocations; an orphan with unknown product blocks all product allocations because its stock origin is unknown.
- A single backend process serializes order reviews and shares the existing per-batch lock with cold-chain evaluation. Concurrent order approvals cannot allocate the same remaining doses through this path.
- A saved shipment reserves stock even if saving its order subsequently fails. Retrying the identical pending allocation recovers without creating another shipment or repeating the chain call. Notification writes have deduplication keys and can be retried.
- The admin dashboard shows real allocation choices and explains ineligible stock. The server rechecks eligibility on approval; the UI is not an authorization boundary.
- Existing chain logging is retained, now keyed to the actual batch. A mock or unconfirmed receipt is not labeled as confirmed on-chain. An RPC exception leaves the order pending. No live chain call was performed during tests.
- New hospital orders reject zero, negative, fractional or nonnumeric dose requests; UUID-based order identifiers avoid millisecond collisions. Advisory available stock excludes ineligible/already-assigned doses.

## Read-only audit and resolved data-classification decision

From `backend`, run:

```powershell
npm run audit:integrity
```

The script uses the configured `MONGO_URI`, disables model auto-creation/index writes, selects only fields needed for reconciliation, and prints a report. It does not migrate, delete, seed, remap, or grant privileges.

Original local findings before user-confirmed demo reconciliation:

- 13 orphan shipments, including 5 with missing product/quantity information.
- 7 telemetry records referencing absent batches.
- 8 previously approved orders without real allocated-batch links.
- 10 batches without a mapped manufacturer account: 9 labeled `Unknown`, plus one labeled `North Plant`.
- No duplicate batch or shipment identifiers found in the audited records.

The project owner subsequently confirmed **all old records are demo/test data**. The local-only `reconcileDemoData.js --execute --confirmed-demo` created 13 explicitly synthetic, unreleased placeholder batches using the previously referenced batch IDs. Missing product/quantity fields are labeled placeholders (zero doses); they are not reconstructed clinical facts. Existing batches are mapped to the demo manufacturer. Explicit demo organization aliases preserve original distributor/destination/hospital strings while providing scoped account access. Eight approved demo orders now have batch/shipment links. Original changed field values are retained in 62 append-only `DemoReconciliation` journal entries.

The fresh audit reports zero orphan shipments, unknown batch owners, orphan/conflicting telemetry, duplicate identifiers or unallocated approved orders. A second reconciliation run plans zero operations. No existing records were deleted; no policy, release approval, quarantine hold, temperature reading or timestamp was changed by reconciliation. Separately, step 3 hashed four existing demo passwords without changing their login values and invalidated prior sessions. Generated local secrets are in ignored `backend/.env`, never committed. See `SECURITY_HARDENING.md`.

## Boundaries

This is single-process prototype allocation, not a distributed transaction or production inventory ledger. Other legacy shipment-creation paths still need coordinated quantity enforcement in the later inventory/security work. A crash after a blockchain write but before the shipment save can still repeat the chain write on retry; resolving that requires the later durable outbox/idempotent-chain design. No stock returns, order amendments, split allocations or clinical eligibility judgments are invented here.

## Step 4–5 verification

101 backend tests across 13 suites and 22 frontend tests across 7 suites passed (123 total). New checks cover snapshot reproducibility, restart recovery, checkpoint/ingestion failure, retry without advancing a second tick, duplicate/overlapping controls, revoked operator access, explicit monitor clocks, missing-first-reading detection, normal scheduled interval timing and monitor errors. Pending raw telemetry retries are not an exactly-once guarantee. Generator reset never erases safety history. Monitoring is opt-in and remains armed through stop/restart until deliberately paused.

## Earlier step 2 verification

Fresh verification: **68 backend tests across 9 suites and 18 frontend tests across 5 suites passed (86 total)**. The **frontend production build compiled successfully**. Non-blocking Node deprecation and outdated Browserslist-data warnings remain. Automated tests cover allocation links, authorization, missing inputs, product/owner/release/hold checks, stock shortage, concurrent/repeated requests, partial-save recovery, notification retries, chain failure/mock handling, legacy conflicts, read-only audit behavior and the allocation form. New backend suites use isolated generated test databases and mocked blockchain calls. The legacy dashboard smoke suite used a separate read-only test database. The allocation suite also passed again after adding an exact-capacity recovery check.
