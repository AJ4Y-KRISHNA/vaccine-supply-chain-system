# Ordered implementation progress

Date: 2026-09-17. This tracks the ten recommendations in section 13 of the project audit. It is not a claim that the full research framework is complete.

| Step | State | Evidence / remaining work |
| --- | --- | --- |
| 1. Checkpoint the prototype | Complete | Local branch `codex/ordered-roadmap-20260917`; checkpoint `2425396`. Existing cold-chain work retained. Environment files, dependency folders and generated artifacts excluded. Not pushed. |
| 2. Repair batch–shipment–order relationships | New-order fix implemented; historical reconciliation awaiting project-owner input | Real batch allocation, eligible stock checks, mapped distributor selection, duplicate/concurrent approval handling, read-only audit. Historical mappings are not inferred. |
| 3. Harden authentication and authorization | Pending | Order review/admin allocation listing now require current database admin identity as part of step 2. The broader authentication, password, secret and legacy-route work is not complete. |
| 4. Simulator UI and durable operation | Pending | Existing simulator remains in-memory. |
| 5. Operational monitoring | Pending | Autonomous missing-telemetry checks and pushed/periodic dashboard updates remain to be implemented. |
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

## Read-only audit and current blocker

From `backend`, run:

```powershell
npm run audit:integrity
```

The script uses the configured `MONGO_URI`, disables model auto-creation/index writes, selects only fields needed for reconciliation, and prints a report. It does not migrate, delete, seed, remap, or grant privileges.

Current local findings:

- 13 orphan shipments, including 5 with missing product/quantity information.
- 7 telemetry records referencing absent batches.
- 8 previously approved orders without real allocated-batch links.
- 10 batches without a mapped manufacturer account: 9 labeled `Unknown`, plus one labeled `North Plant`.
- No duplicate batch or shipment identifiers found in the audited records.

These findings mean existing ambiguous inventory is intentionally not eligible for new approval. The user must confirm whether it is historical demo data or records requiring factual reconciliation. For retained operational records, supply an explicit mapping using `RECONCILIATION_INPUT.example.json` as a guide. Unknown values must remain unresolved; the script does not fill them in.

No historical application records were changed in this implementation. No passwords, account ownership, product policies, or existing quarantine/review records were changed. Later roadmap stages remain pending while this ordered data-reconciliation decision is outstanding.

## Boundaries

This is single-process prototype allocation, not a distributed transaction or production inventory ledger. Other legacy shipment-creation paths still need coordinated quantity enforcement in the later inventory/security work. A crash after a blockchain write but before the shipment save can still repeat the chain write on retry; resolving that requires the later durable outbox/idempotent-chain design. No stock returns, order amendments, split allocations or clinical eligibility judgments are invented here.

## Verification

Fresh verification: **68 backend tests across 9 suites and 18 frontend tests across 5 suites passed (86 total)**. The **frontend production build compiled successfully**. Non-blocking Node deprecation and outdated Browserslist-data warnings remain. Automated tests cover allocation links, authorization, missing inputs, product/owner/release/hold checks, stock shortage, concurrent/repeated requests, partial-save recovery, notification retries, chain failure/mock handling, legacy conflicts, read-only audit behavior and the allocation form. New backend suites use isolated generated test databases and mocked blockchain calls. The legacy dashboard smoke suite used a separate read-only test database. The allocation suite also passed again after adding an exact-capacity recovery check.
