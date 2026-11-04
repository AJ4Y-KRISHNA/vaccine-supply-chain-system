# Website control and layout audit

Audit date: 23 September 2026. Scope: every route mounted by `frontend/src/App.js`, the components those routes render, and the API workflows behind their operational controls. Software-only synthetic prototype; this is not clinical validation or a claim of production readiness.

## Controls checked and repaired

| Page / area | Controls and behavior |
| --- | --- |
| Login | Username/password/role, password visibility, reset, submit; visible failure, guarded double submit, navigation based on server-issued role. |
| Session / routing | Logout clears local tokens and identity. Expired/invalid sessions redirect. Same-role account changes discard previous dashboard state. Unknown URLs show a recovery link. Server authorization remains authoritative. |
| Manufacturer | Dashboard refresh; Create New Batch/New batch; full batch history search, view, refresh and close; old and recent batch Production/Lab sign-offs; certificate records; alert, IoT and audit section navigation. Creation/sign-off success is distinguished from a later failed refresh. |
| Manufacturer records | Raw-material, production and report details; batch-specific blockchain audit; inventory certificate confirmation and release state. Certificate records are explicitly not clinical quality approval. |
| Distributor | Shipment search, status filtering, verify, dispatch, supply, history, report export, alert navigation, blockchain audit, refresh and logout. Operational actions respect backend assignment, release, product identity and hold checks. |
| Hospital | Order request, incoming-delivery confirmation, confirmed-stock batch selection, administration/report workflow, history/export, feedback, alerts, refresh and logout. Organization comes from the account; client-entered stock cannot create inventory. |
| Admin | Sidebar sections, search, refresh/retry, alert navigation, monitoring tabs, audit drill-down, sentiment, order approve/decline, allocation inputs, supply-plan preview and feedback filters. User directory is read-only because the project has no account-edit API. |
| Supply planner | Explicit capacities, destination/order selections and ISO clock validated; preview remains advisory and does not dispatch stock. |
| Virtual IoT | Device creation, seed/clock/range/route validation, batch/shipment selection, refresh, start, stop, tick, reset, scenario switch and optional silence monitoring. Duplicate clicks guarded. Reset still does not erase telemetry or holds. |
| Cold-chain policy | Inspect policy, batch selection, explicit approved-rule inputs, approval and clock checks. Changing batch clears stale draft/evidence. No universal medical threshold is introduced. |
| Alert queue | Status/severity/batch/date filters, apply/clear, refresh, acknowledge, quarantine, review, clear, reason/evidence/cancel controls, notifications and audit history. Review and clearance remain permission- and evidence-gated. |
| Blockchain timeline | Batch search/selection, loading/error/empty states and refresh; selection matches the displayed batch. Uses local chain only. |
| Architecture / system overview | Role-appropriate workflow activity, independent failures, refresh and return to dashboard. Counts are stored activity, not proof every production requirement is complete. |

## Layout changes

- Consistent navy header/sidebar, readable navigation and content widths, aligned responsive cards and forms.
- Mobile navigation wraps; tables scroll inside their panels rather than widening the whole page.
- Visible keyboard focus, labeled inputs, accessible error/status feedback, dismissible notifications and reduced-motion support.
- Removed decorative controls that suggested actions without implementing one. Empty charts no longer display invented operational numbers. Manufacturer production totals/reports are labeled as production, not distribution.

## Backend safeguards included in this audit

- Manufacturing input validation, canonical duplicate ID checks, account-bound ownership and a read-only local-chain preflight.
- Creation preserves partial records after failures and rejects blind resubmission of incomplete workflows; MongoDB and blockchain are not one atomic transaction.
- Shipment verification/dispatch/supply/receipt transitions checked on the server; product and release/hold boundaries are retained.
- Healthcare stock derived from confirmed, scoped receipts; administration debits cannot exceed confirmed available doses. Manufactured batch quantity is not rewritten when a hospital administers doses.
- Interrupted vaccination requests retain an operation identifier. Replaying an already-completed request returns its existing result, not a second stock debit. Partially recorded operations are explicitly blocked for inspection/reconciliation; there is no claim of automatic cross-database/blockchain rollback.
- Dashboard administration charts no longer count report copies as additional administrations; incoming receipt actions no longer include shipments that have not been supplied.

## Verification and limits

Frontend component tests exercise successful actions, validation, loading, errors and important retry/race cases. Backend tests use isolated MongoDB databases. `backend/scripts/runSystemAcceptance.js --execute` exercises real HTTP, MongoDB, Python and local Hardhat transactions using fresh synthetic records, including manufacture, approvals, orders, telemetry, quarantine/review, delivery and administration.

At the earlier UI-audit checkpoint, backend regression had **17 suites / 145 tests passed** and frontend regression had **19 suites / 85 tests passed**. The production frontend build compiled successfully, and `git diff --check` passed. These are historical checkpoint counts, superseded by the later Phase 8 verification in [PHASE_EXECUTION.md](PHASE_EXECUTION.md); the build reported Node deprecation and stale Browserslist-data notices, not compilation errors.

Earlier UI-audit acceptance: **43 HTTP requests passed**, including four telemetry readings and eight audit anchors. Replaying the same administration operation returned the original administration/report identifiers and transaction hash: one dose administered, 39 remaining, without a second debit. This historical run is superseded by the later 52-request acceptance documented in [SYSTEM_ACCEPTANCE.md](SYSTEM_ACCEPTANCE.md). The runner cleaned its own isolated test database and temporary services; application data was unchanged.

Browser verification covered sign-in, the manufacturer desktop layout, opening the new-batch form and required-input feedback against an isolated preview. The in-app browser crashed while using its native date picker, and subsequent automated browser access could not recover. Therefore this audit does **not** claim a completed click-through of every role or mobile viewport. Those remaining visual checks should be performed in Chrome/Edge using the checklist below; business actions were exercised separately by component and real-HTTP tests.

Optional `--preview` starts a separate frontend with temporary isolated accounts for browser checks. Use an interactive terminal, enter `exit` to stop it; it also closes after 20 minutes. Only that run's temporary database/services are cleaned up. Never use its credentials or fixtures as real data.

Inactive legacy components are not new features: the old distribution form now directs users to the approved order workflow, legacy charts require supplied data, and the duplicate legacy App entry forwards to the real application. Appointment scheduling, account editing, clinical certification, physical IoT and public-chain deployment are not secretly added or presented as working features.

After applying source changes, restart the backend, refresh the frontend and sign in again. Keep MongoDB, the local blockchain/deployed contract and the AI service running. Do not reset your normal Hardhat chain just to refresh the website.

## Final browser walkthrough

1. At 100% browser zoom, sign in separately as each role. Check that the header, navigation, cards and tables remain readable at desktop width and with a narrow window.
2. Manufacturer: create a new uniquely identified synthetic batch with a future expiry. Open its history, perform production/lab sign-offs, and inspect its certificate record and audit timeline.
3. Hospital: submit a new order. Admin: approve it using an eligible released batch and the correct distributor mapping.
4. Distributor: search for the allocated shipment, verify, dispatch and supply it. Export the filtered report. Hospital: confirm receipt and record a synthetic administration; verify the stock decreases once.
5. Manufacturer/admin: create a uniquely identified virtual device, select the fresh batch, and use fixed seed/clock inputs. Exercise tick/start/stop and normal/high scenarios against an explicitly entered synthetic policy. Inspect the alert explanations and quality-review controls. Reset must not erase saved evidence or clear holds.
6. Exercise refresh, search/filter, cancel, empty-input validation and logout. Reopen protected URLs after logout and verify that sign-in is required. Read-only directory, appointment and diagram sections should not suggest unavailable editing/scheduling/live-GPS actions.
