# Integrated software-only acceptance — 2026-09-17

**PASS**: the initial combined-manufacturing run used 33 HTTP requests; the final run used 36, also checking the separate raw-material, production, batch and report endpoints before release. Both ran through the actual Express application, actual local Python FastAPI service, actual MongoDB, and a newly deployed Hardhat contract on chain 31337. No chain or AI mocks were used. All accounts, inventory and policies were isolated synthetic fixtures in randomly named test databases.

Verified sequence:

1. Authenticate four test roles; manufacture 100 synthetic dose-units through the existing manufacturer workflow.
2. Sign release using distinct production/lab blockchain addresses; verify the on-chain batch.
3. Obtain an actual Python baseline forecast: trend fixture predicts 44 using drift.
4. Hospital requests 40 units; admin capacity/expiry plan proposes 40; explicit approval reserves one real batch-linked shipment.
5. Reject a second shipment requesting 61 units when only 60 remain.
6. Three seeded high-temperature readings produce quarantine after exactly 120,000 simulated milliseconds under the synthetic fixture policy.
7. Reject dispatch and administration during quarantine; all four relevant roles can read the alert.
8. Switch to normal; verify that normal telemetry alone does not remove the hold. Reject clearance before review, then record a synthetic quality review and explicitly clear.
9. Distributor verifies/supplies the shipment; hospital confirms delivery of 40 units.
10. Anchor all eight cold-chain audit events on the real local chain; recompute and verify all eight digests. Replaying the worker creates no new anchors.

In the final run, four telemetry HTTP requests took 36–52 ms (reported upper-middle sample 52 ms). This is not a representative latency distribution or production benchmark. No real product, patient, medical approval, physical temperature sensor or actual vaccine delivery is represented.

Reproduce from `backend`:

```powershell
node scripts/runSystemAcceptance.js --execute
```

Prerequisites: local MongoDB; installed repository dependencies; compiled contract (`npm test` from `blockchain` compiles/tests); Python with FastAPI/uvicorn. Set `PYTHON_EXECUTABLE` if necessary. The runner selects temporary loopback ports, creates only its own random `codex_cc_test_<hex>` database, and launches hidden child services. It never loads credentials from the application's database. It stops its services and deletes only its own disposable test database afterward. The existing `vaccineDB` records and `.env` are unchanged. Deleted fixtures are reproducible with this command; they are not retained dashboard records.

This validates one happy path plus specific safety failures. It is not a production security review, multi-worker recovery proof, independent organizational multisignature workflow, browser end-to-end test, or clinical validation.
