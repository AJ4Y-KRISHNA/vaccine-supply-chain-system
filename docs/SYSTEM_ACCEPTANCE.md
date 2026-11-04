# Integrated software-only acceptance — Phase 2 Edge Gateway run, 2026-10-05

## Phase 6 real-time UI checks (2026-10-06)

The `/ws/dashboard` socket is attached to the normal backend HTTP listener, authenticates the current user using the existing access token, and filters events against Admin, manufacturer batch, distributor shipment, and healthcare destination scope. Focused integration tests delivered a synthetic reading to Admin, Distributor and Healthcare clients in under 1 second, with the pre-existing Field Operator listener attached simultaneously; frontend tests confirmed pushed chart refresh, Live/Degraded state and SVG policy/excursion display. Both backend and frontend Compose images were rebuilt/recreated and passed health checks, and a read-only handshake to the running backend returned the authenticated Admin `READY` message. Run instructions and exact coverage are in [PHASE6_REALTIME_UI.md](PHASE6_REALTIME_UI.md). Dashboard views keep polling only while socket state is degraded.

## Phase 5 Merkle acceptance (2026-10-06)

`node backend/scripts/runBlockchainAcceptance.js --execute` creates an isolated synthetic Mongo database and Hardhat child process. It validates real HTTP telemetry, anchors a root, queries both new verification endpoints, verifies a batch without sensor evidence, modifies one stored reading and asserts verification failure, restores the value and verifies again. Gas/count metrics remain under `backend/data/blockchain`. The broad system acceptance also invokes `verifyPhase5Blockchain.js` after its legacy evidence/analytics checks. See [PHASE5_BLOCKCHAIN.md](PHASE5_BLOCKCHAIN.md) for non-destructive Docker upgrade and proof semantics. Browser-camera capture and public-chain operation are not claimed.

## Phase 4 analytics acceptance (2026-10-06)

`node backend/scripts/runAnalyticsAcceptance.js --execute` runs the actual seed and real Python analytics APIs in a disposable database. It verifies all four seeded logins, three product/region histories, 35 complete months, genuine SARIMA versus seasonal baseline evaluation, prediction bounds, append-only saved forecasts, retained JSON metrics, organization scope, Admin-only explicit approval and unchanged stock. A separate clearly marked released-stock database fixture exercises nonzero SciPy allocation under 50-dose regional/40-dose transport capacity; that fixture is not proof of a new signing workflow. Fresh seed correctly has zero eligible stock due to existing release gates. `runSystemAcceptance.js` now also invokes `verifyPhase4Analytics` after its full existing manufacturing/signing/shipment/alert/blockchain flow. See [PHASE4_ANALYTICS.md](PHASE4_ANALYTICS.md) for commands, assumptions and UI verification boundaries.

## Phase 3 event-backbone acceptance (2026-10-06)

`node backend/scripts/runEventBackboneAcceptance.js --execute` adds actual Redis consumer-group and Mongo replica-set verification using isolated namespaces. The proof stopped/restarted a disposable AI container and Hardhat process, verified ingestion/policy/in-app fanout continued, all four groups caught up, four measurements and GPS points remained duplicate-safe, one temperature alert represented the excursion, transaction rollback removed partial alert/audit/outbox effects, and 12 Ethereal captures covered Admin/Manufacturer/Distributor/Healthcare. The initial chain-catch-up attempt lacked batch registration on the fresh test node; the corrected proof redeploys/registers explicitly. Existing demo services/data were not stopped/reset.

The legacy `runSystemAcceptance.js --execute` also passed after Phase 3: 58 HTTP requests, 26 evidence entries, 13 verified raw telemetry records, and full manufacture/order/review/delivery/administration/QR workflow. This legacy run explicitly uses EVENT_BACKBONE_ENABLED=false; the new proof exercises enabled stream mode. See EVENT_BACKBONE.md for configuration and remaining single-process/volatile-chain boundaries.

The expanded outage proof subsequently passed stream-worker stop/start while external dependencies were down, then catch-up with no pending entries and committed telemetry fetched through the existing HTTP history controller. Nine Compose services are healthy after rebuilding; the four consumer groups were queried on the running Redis instance. No application records were removed; only each proof's isolated test DB/Redis keys and disposable services were cleaned up.

**Core integrated workflow PASS on 2026-10-05 after Phase 2**: 52 HTTP requests exercised the separate Edge Gateway process, actual Express application, local Python FastAPI service, MongoDB and a newly deployed Hardhat contract on chain 31337. Five baseline telemetry readings and subsequent simulator ticks passed through the gateway's HTTP authentication, shared-schema validation and upstream-forwarding path before entering the existing backend. No chain or AI mocks were used. The runner also checked correlation-ID response/persistence, simulator-to-alert/notification propagation, and the FastAPI response header. Optional email was disabled for this run; outbox behavior is covered by unit tests and no actual email was sent. All accounts, inventory and policies were isolated synthetic fixtures in a randomly named test database. Earlier runs used 33, 36, and 52 requests.

Verified sequence:

1. Authenticate four test roles; manufacture 100 synthetic dose-units through the existing manufacturer workflow.
2. Sign release using distinct production/lab blockchain addresses; verify the on-chain batch.
3. Obtain a Python baseline forecast from persisted synthetic orders (latest run: 22 using drift).
4. Hospital requests 40 units; admin capacity/expiry plan proposes 40; explicit approval reserves one real batch-linked shipment.
5. Reject a second shipment requesting 61 units when only 60 remain.
6. Three seeded high-temperature readings produce quarantine after exactly 120,000 simulated milliseconds under the synthetic fixture policy.
7. Reject dispatch and administration during quarantine; all four relevant roles can read the alert.
8. Switch to normal; verify that normal telemetry alone does not remove the hold. Reject clearance before review, then record a synthetic quality review and explicitly clear.
9. Distributor verifies/supplies the shipment; hospital confirms delivery of 40 units.
10. Anchor the cold-chain audit events and all nine batch-linked temperature readings on the local chain. Recompute and verify all 20 digest/raw-record evidence entries; read the complete raw history directly from the contract.
11. Build the latest chain-reading QR proof and verify its batch, record ID, digest, chain ID and contract address through the authenticated, role-scoped API. Replay the worker and confirm it creates no duplicate history.
12. Confirm the supplied `X-Correlation-ID` is echoed and stored for HTTP readings; confirm generated simulator IDs reach telemetry, the active alert and its notifications; confirm the AI service echoes the forwarded ID.

In the latest Phase 2 rerun on 2026-10-05, four simulator tick requests took 50–70 ms (median 62 ms). These are individual local test runs, not a representative latency distribution or production benchmark. No real product, patient, medical approval, physical temperature sensor or actual vaccine delivery is represented.

Reproduce from `backend`:

```powershell
node scripts/runSystemAcceptance.js --execute
```

Prerequisites: local MongoDB; installed repository dependencies; compiled contract (`npm test` from `blockchain` compiles/tests); Python with FastAPI/uvicorn. Set `PYTHON_EXECUTABLE` if necessary. The runner selects temporary loopback ports, creates only its own random `codex_cc_test_<hex>` database, and launches hidden child services. It never loads credentials from the application's database. It stops its services and deletes only its own disposable test database afterward. The existing `vaccineDB` records and `.env` are unchanged. Deleted fixtures are reproducible with this command; they are not retained dashboard records.

Phase 2 backend regression passed: Jest 44 suites / 268 tests, including gateway HTTP, MQTT bridge and legacy path compatibility. Other UI, Python and Hardhat source was unchanged in this phase; their last full regression counts are recorded in the phase history below. The gateway MQTT bridge was disabled during integrated acceptance; MQTT handler/topic/ack behavior is unit-tested with an injected client, but no live broker flow was proven by this acceptance run. A final local check found no listener on port 1883 and the Docker engine did not respond, so Mosquitto could not be started for a real-broker test.

This validates one happy path plus specific safety failures. It is not a production security review, multi-worker recovery proof, independent organizational multisignature workflow, browser end-to-end test, Edge Gateway/Redis Streams verification, or clinical validation.
