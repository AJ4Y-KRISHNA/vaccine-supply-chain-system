# Event Backbone — Phase 3

## Scope

Synthetic software simulation only: no physical sensors, clinical validation, production guarantees or public blockchain. Approved batch policy rules remain authoritative; AI outputs are advisory.

## Configuration and compatibility

Compose enables `EVENT_BACKBONE_ENABLED=true`. Standalone backend configuration defaults to the existing synchronous path (`false` in `backend/.env.example`). HTTP/MQTT payloads and the array response shape remain compatible, but an enabled response is an **acceptance receipt**, not completed evaluation: `eventId`, `correlationId`, `accepted=true`, `processingStatus=QUEUED`. Read existing REST history or WebSocket updates for committed results. Redis failure rejects acceptance; the gateway retains queued messages for retry.

The added `redis` dependency is the standard Node client for Streams, consumer groups and atomic commands. MongoDB must be a replica set. Compose idempotently initializes single-node `rs0` using the existing volume without dropping/reseeding data. Stream-mode initialization verifies this before HTTP startup. Host tools use `mongodb://127.0.0.1:27018/?directConnection=true` when the selected host port is 27018; internal services use `mongo:27017`. Standalone Mongo deployments can leave stream mode disabled.

## Data path

Validated ingress → atomic Redis `telemetry.accepted` publish/dedupe receipt → independent consumer groups → existing Mongo projections/local Hardhat evidence → existing REST/WebSocket reads.

| Group | Work and dependency | Commit/ack boundary |
| --- | --- | --- |
| persistence | Idempotent TemperatureLog, LocationHistory, time-series measurements | Completion receipt after writes; ack after handler returns |
| policy-alert | Wait for persistence; existing approved policy evaluator, no AI call | Transaction: state/holds, alerts, append-only audit, notification outbox, evaluation and receipt |
| ai-advisory | Wait for persistence; independent FastAPI call | Save advisory result; unavailable stays pending for retry |
| anchoring | Wait for persistence and policy commit; canonical digest/raw-temperature chain functions | Receipt after evidence confirmation; chain failure retries independently |

`eventBackbone.js` uses XGROUP, XREADGROUP, XAUTOCLAIM and XACK. There is **one backend process with one sequential loop per group**, not four separately deployed services. Stable consumer names recover pending work after restart. Do not run multiple backend replicas with these names: multi-replica leases/distributed WebSocket delivery are not implemented. An oldest failed event waits for retry/DLQ within its group; other groups continue.

Retry metadata persists in Redis: exponential backoff starts at 500 ms, caps at 30 seconds, and defaults to 20 external-service attempts (`EVENT_MAX_ATTEMPTS`). Waiting for upstream consumers does not spend that budget. Exhausted events are atomically copied to `<prefix>:dead-letter:<group>` and acknowledged. Stream entries/dedupe receipts are not automatically trimmed, preventing deletion of unacknowledged catch-up work; capacity/compaction remains future operational work. Redis AOF uses its configured durability settings, not an exactly-once transport guarantee.

Replay a repaired telemetry group explicitly:

```powershell
docker compose exec -T backend node scripts/replayEventDeadLetters.js anchoring
```

This republishes up to 100 envelopes per invocation. All groups see replay; completed receipts prevent repeated committed effects. Notification/email dead letters retain Mongo row IDs for investigation/requeue and are not handled by this telemetry replay command.

## Persistence and retention

`telemetry_measurements` uses `recordedAt` as time field, `device` as metadata, seconds granularity, and indexes for batch/time and event lookup. It stores sensor/GPS values, edge flags, event/correlation identity and synthetic provenance. Default retention is 7,776,000 seconds (90 days), configurable through `TELEMETRY_RETENTION_SECONDS` at initial creation. Location history's existing time index becomes TTL. Expiry is asynchronous.

Regular TemperatureLog remains the mutable, uniquely idempotent dashboard/evaluation projection, preserving existing queries/chain record IDs. Existing records are not migrated/deleted. Existing time-series retention is not silently changed every boot. MongoDB 7 time-series writes cannot join these transactions or use unique event indexes; the single persistence loop checks eventId on replay before inserting. This is at-least-once with replay deduplication, **not a multi-worker exactly-once guarantee**. The group receipt marks completion.

## Policy and notification outbox

The existing excursion key maintains one active alert per batch/shipment/device/metric. Recovery closes the excursion but does not clear a quarantine without human review. Mongoose async-local sessions propagate the transaction through policy writes. Failure leaves no alert/audit/outbox row. SMTP never runs inside the transaction. The armed missing-reading watchdog also uses a transaction in stream mode.

NotificationOutbox stores the committed transition snapshot once per alert/stage. Its dispatcher creates deduplicated in-app records for Admin, owning Manufacturer, and the shipment's assigned Distributor/Healthcare organization. Matching enabled users receive queued emails through the existing EmailDelivery worker. Compose uses Ethereal capture, not real-recipient delivery; previews remain on delivery/notification records. Both outboxes retry. Exhausted notification/email attempts are copied to Redis `dead-letter:outbox` / `dead-letter:email` streams; operator investigation/requeue is required after exhaustion.

## AI and local chain

The rolling median/MAD and trend detector returns `score` and `feature_contributions` for temperature, humidity when supplied, and projected trend crossing. Equal-weight normalized deviations plus a crossing indicator sum to the score. This is a statistical heuristic, not SHAP, a trained model or a safety probability. Insufficient history gives a null score. Failure stores UNAVAILABLE, null score and empty contributions; policy/notifications continue. Pending advisories retry after restart. Async AI enriches readings without re-running policy or setting holds.

Anchoring reuses individual audit digests/raw-temperature records; Merkle batching is not added here. The legacy scan worker remains for non-telemetry audits and old records. RPC requests have bounded timeouts. Manufacturer batch registration remains explicit: **Mongo-only seeded batches are not automatically registered on-chain** and raw telemetry cannot confirm until the batch exists there.

Hardhat is volatile: a fresh node does not restore prior confirmed chain history. The outage proof uses a disposable node and redeploys/registers its synthetic batch before replaying previously unconfirmed work. Existing application-chain evidence is not reset by the proof.

## Verification

Run backend Jest, AI pytest, the existing `runSystemAcceptance.js --execute`, and:

```powershell
Set-Location "D:\proejcts\vaccine-supply-chain-system"
node backend/scripts/runEventBackboneAcceptance.js --execute
```

The new proof needs running Compose Mongo/Redis, the built AI image, and installed backend/blockchain dependencies. It privately reads root .env, allocates a unique test DB/Redis prefix, and starts disposable AI/Hardhat instances. It stops/restarts only those instances, verifies outage independence/catch-up, duplicate safety, rollback, retention and all-role Ethereal capture, then removes only its isolated test data/services. Root `npm run acceptance:events` runs the same proof when npm is available.

Unit tests cover identities, ack boundary, retry/backoff, dependency waits, DLQ exhaustion and additive/null AI scores. The legacy acceptance covers manufacturer/order/dispatch/review/delivery/administration, dashboard reads, gateway and QR evidence compatibility. Actual results are recorded in CURRENT_STATE.md and SYSTEM_ACCEPTANCE.md.
