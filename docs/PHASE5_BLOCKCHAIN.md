# Phase 5 — Local Merkle sensor evidence

## Scope

Synthetic software simulation only, not clinical or production verification. Batch registration, release signatures, lifecycle/status histories, legacy raw-reading APIs and old transaction-bearing QR links remain supported. Policy alerts remain authoritative; anchoring and AI never control stock or dispatch.

## Data flow

The Redis anchoring consumer waits for persistence/policy completion, durably stages each accepted reading in `MerkleLeaf`, then acknowledges its event. The periodic audit worker drives `merkleAnchoring.processOnce` independently of ingestion and alerts. Chain outages leave immutable windows pending/failed for exponential retry (up to 60 seconds), without rebuilding roots. Historical persisted readings without confirmed legacy anchors are staged as recovery. Unique reading IDs make staging idempotent. Audit events retain separate digest anchoring; new sensor values remain off-chain.

## Commitments

- Fixed five-minute UTC buckets per batch, capped at 100 readings. Full chunks close early; smaller chunks close after bucket end. Late arrivals create another chunk without rewriting prior roots.
- Leaves sort by Mongo reading ID. SHA-256 leaves hash byte `0x00` plus canonical key-sorted `synthetic-sensor-merkle-v1` JSON; parents hash byte `0x01` plus left/right 32-byte hashes. Odd levels duplicate their last node; single-leaf proofs are empty.
- Raw values, identity, timestamps, GPS, edge metrics and synthetic provenance are committed. Mutable policy/AI output and UI status are excluded. Off-chain leaves store digest, directional proof, index and window ID.
- Mongo replica-set transactions assign leaves and create the window snapshot atomically. The contract stores window ID, root, batch ID, bounds and count, never new raw readings. Window IDs commit batch, bucket, reading IDs and root.
- Identical contract retries are no-ops; changed roots/metadata are rejected. Recovery after mining reads the root and original receipt. Actual gas and gas/count are saved and structured-logged with correlation ID.

Evidence: `backend/services/merkleTree.js`, `merkleAnchoring.js`, `eventConsumers.js`, `auditAnchoring.js`; `models/MerkleLeaf.js`, `MerkleWindow.js`; `blockchain/contracts/VaccineSupplyChain.sol`.

## Lifecycle and deployment compatibility

`logTransportLifecycle` retains lifecycle fields and adds a structured shipment/vehicle/route event and getter. Distributor receive/verify/update/supply/confirmation actions pass IDs from the shipment. `Shipment` accepts vehicle/route IDs; unassigned identities remain empty, never invented. Batch-only manufacturing events have no shipment identity. Legacy events are not rewritten.

An optional `MERKLE_CONTRACT_ADDRESS` preserves the original batch `CONTRACT_ADDRESS`: the wrapper writes the original lifecycle and additionally writes transport lifecycle in the companion. The lifecycle API exposes the companion's `transportLifecycle` separately. These transactions are not atomic; an interrupted second write requires receipt investigation. Fresh contracts can use one address. Companion anchoring does not itself register a batch; the verify API separately checks the original contract.

`TELEMETRY_ANCHOR_MODE=merkle` is the default/Compose setting. Explicit `legacy` retains individual digest/raw writing for compatibility. Already-confirmed legacy readings are not silently re-anchored. Hardhat is in-memory: restarting it loses chain state even with retained volumes. **Do not restart/recreate the existing node for this upgrade.**

## API and QR

- `GET /api/verify/:batchId`: authenticated and organization-scoped registration check, temperature summary, latest 100 reading proofs/root comparisons and up to 100 distribution records.
- `GET /api/verify/:batchId/reading/:id`: scoped individual reading, batch, summary, distribution records, leaf/proof/root comparison and gas metadata.
- Batch `verified` refers only to registered identity. Sensor state is `yes` for successfully compared evidence, `pending` for collection/retry/unavailable comparison, `no` for no readings or integrity failure. `integrityFailure` is separate from registration.
- The page discloses its 100-reading verification limit and pending counts. `yes` does not mean all historical readings were checked; older readings use the individual API. Distribution output is scoped and capped at 100.
- New QR codes encode the current frontend origin plus `/verify/<batchId>`. Sign-in resumes that protected page. It separates “Batch verified” from “Sensor evidence anchored: yes / pending / no”. Healthcare manual entry/paste and supported-browser camera scanning remain. Legacy full proofs still use the transaction/digest endpoint.
- Readiness separately reports companion availability and window counts; blockchain history displays Merkle status and retains legacy raw records.

Verification recomputes the current reading hash and compares the originally staged leaf, directional proof and actual on-chain root, including batch, bounds, count, chain ID and configured contract. A saved confirmed flag is insufficient. This proves integrity after commitment, not source correctness, physical handling or clinical safety.

## Upgrade without resetting the chain

From repository root:

```powershell
docker compose build hardhat backend frontend
docker compose run --rm --no-deps -e RPC_URL=http://hardhat:8545 --entrypoint sh hardhat -c "npx hardhat compile && cp -R artifacts/. /shared-artifacts/ && node scripts/deployMerkleCompanion.js --execute"
```

Copy the printed non-secret `MERKLE_CONTRACT_ADDRESS=...` into root `.env`. Preserve the original batch address. The helper reuses its verified deployment metadata when rerun. Then:

```powershell
docker compose up -d --no-deps --wait --wait-timeout 180 backend frontend
docker compose ps
```

The new Hardhat image is built without recreating the running node. Fresh deployments already have root methods on their main contract. After any separate chain reset, recheck addresses and treat old commitments as unavailable; Mongo receipts cannot prove restarted-chain records.

## Repeatable verification

```powershell
cd blockchain
npm test
cd ..
$env:ACCEPTANCE_MONGO_URI = 'mongodb://127.0.0.1:27018/?directConnection=true'
$env:MONGO_TEST_URI = $env:ACCEPTANCE_MONGO_URI
node backend/scripts/runBlockchainAcceptance.js --execute
```

The acceptance script creates an isolated synthetic database and child local chain, validates readings through authenticated HTTP ingestion, checks proofs/gas, checks a no-evidence batch, alters one stored temperature and asserts failure, then restores and verifies it. It cleans only its own database/chain and retains thesis JSON in `backend/data/blockchain`. `--preview` serves a production frontend with disposable credentials for ten minutes; send input to end early interactively.

Mongo must be the Compose replica set, not an older standalone instance: window assignment uses transactions. For the optional real Redis consumer proof, use the running local authenticated Redis without printing its password:

```powershell
$env:REDIS_PASSWORD = (docker compose exec -T backend node -p "process.env.REDIS_PASSWORD").Trim()
node backend/scripts/runBlockchainAcceptance.js --execute --streams
Remove-Item Env:REDIS_PASSWORD
```

This mode stages accepted HTTP readings through all four Redis consumer groups and removes only its unique test stream prefix afterward. The acceptance helper then processes due Merkle windows explicitly; the application's existing anchoring timer processes them in normal operation.

The broader system acceptance retains the legacy shipment/alert/raw-chain checks and adds `verifyPhase5Blockchain.js`. The existing Phase 3 outage proof explicitly stays in legacy mode; Merkle outage/staging independence is covered separately. Unit tests cover odd trees, count/time closure, duplicates, independent staging during outage, late arrivals, batch separation, raw tampering, false roots/contracts, scoped APIs and UI states.

## Verification results

- Backend: 55 Jest suites / 328 tests passed using the Compose replica set and a 15-second per-test timeout. Earlier concurrent builds caused timeouts; an older standalone Mongo instance also rejected transactions. The final correct-environment run passed. The simulator lock test now waits for completion with a bounded deadline instead of assuming completion within 30 ms; its persistence-lock assertion is unchanged.
- Frontend: 35 suites / 152 tests passed, including Merkle states, generated QR links and readiness compatibility. Hardhat: all 9 contract tests passed.
- Real Redis acceptance passed with three accepted HTTP readings staged by the anchoring group, one root transaction, actual on-chain proof comparisons, duplicate suppression, stored-temperature tamper rejection and restored verification. Actual gas: 141146 total / 47048.67 per reading for this three-reading fixture. JSON retained at `backend/data/blockchain/SYNTHETIC-MERKLE-1791267654230.json`. This is a fixture measurement, not a general throughput benchmark.
- Broader isolated system acceptance passed 71 measured HTTP requests, legacy lifecycle/release/raw-reading checks, forecast/supply checks and the Phase 5 tamper helper. This run captured zero emails; it is not new email-delivery evidence.
- Browser verification of the built frontend passed: protected sign-in return to verification URL, an anchored batch with three verified readings, a registered batch without readings, and distinct generated QR codes/URLs for both. Their sensor states were respectively `yes` and `no`; pending is covered by API acceptance and UI tests. Physical camera scanning, Safari/iOS and public blockchain deployment were not tested.
- The running local batch contract was preserved. A writer-authorized companion contract was deployed for the new root/transport methods; backend/frontend were rebuilt without restarting Hardhat or resetting application data. Disposable acceptance databases and child chains were removed after tests; retained metric files remain.
- After deployment all nine Compose containers reported healthy. Authenticated readiness reported MongoDB, main chain, Merkle companion, AI, MQTT, Redis and backend healthy, but demo email unavailable. Container liveness is not email delivery proof; the email transport remains a separate outstanding readiness issue.
