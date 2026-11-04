# Architecture Decisions

## Current decisions (updated through Phase 11, 2026-10-07)

### ADR-009 — Approved policy is authoritative; AI remains advisory

- **Status:** Accepted.
- **Context:** Statistical anomaly output can help explain unusual readings, but it is not a validated safety classifier. Policy alerts must remain explainable and reviewable.
- **Decision:** Only an approved, batch-linked `ColdChainPolicy` determines cold-chain violations, quarantine and clearance eligibility. AI may add scores, labels and plain-language feature contributions; it cannot open/close policy alerts, clear a hold, change stock, or dispatch.
- **Consequences:** A missing policy yields an unevaluated status, not an inferred limit. Evaluation labels describe synthetic scenario intent, not clinical ground truth.

### ADR-010 — Redis Streams separates accepted telemetry from consumers

- **Status:** Accepted for the local demonstration.
- **Context:** Persistence, policy evaluation, advisory inference and Merkle staging have different failure modes; AI or chain downtime should not block telemetry acceptance or authoritative alerts.
- **Decision:** Publish validated telemetry to Redis Streams and process it with sequential consumer groups, idempotent Mongo receipts, bounded retries and dead-letter streams. Since Phase 8 the local deployment hosts these groups and the outbox in a separate `backend/worker.js` process; `WORKER_MODE=external` keeps them out of the API. They remain independent groups in one worker, not separately scaled production services.
- **Consequences:** HTTP/MQTT acceptance means queued/accepted, not every downstream consumer has completed. Redis is not the permanent source of truth; MongoDB is.

### ADR-011 — Anchor sensor windows with off-chain Merkle proofs

- **Status:** Accepted for Phase 5.
- **Context:** Writing each raw sensor value to a local chain is expensive, while policy and AI projections may change later.
- **Decision:** Hash immutable sensor identity/value/provenance into domain-separated SHA-256 leaves; group at most 100 readings per fixed five-minute batch window; store leaves/proofs in MongoDB and write only root plus batch/window metadata to the contract. Recompute proofs and compare against the configured chain during verification.
- **Consequences:** A Merkle match proves integrity against the committed root, not sensor truth, physical handling, vaccine quality or clinical safety. Hardhat history is ephemeral; existing deployed batch-contract addresses are preserved during upgrades.

### ADR-012 — Local Hardhat only for blockchain demonstrations

- **Status:** Accepted.
- **Context:** The project is a software-only M.Tech demonstration and has no production key-management, public-chain governance or clinical compliance controls.
- **Decision:** Use the local Hardhat network (chain ID 31337) and local demo signers only. Do not configure Sepolia/Mainnet or present local receipts as public-chain evidence.
- **Consequences:** Restarting/recreating the node erases its in-memory history. Readiness checks show local contract availability; users must preserve the running node when they need previously anchored demo evidence.

### ADR-013 — Scenario-injection labels and normal-only advisory calibration

- **Status:** Historical Phase 9 baseline (2026-10-07); GPS labels/features are superseded by ADR-015 and edge calibration by ADR-014.
- **Context:** The earlier AI comparison derived “ground truth” from the approved 2–8°C threshold. That made threshold precision/recall tautological and mislabeled sensor-integrity/GPS faults as normal. The advisory detector also used a fixed robust-z cutoff that was not calibrated against normal operation.
- **Decision:** The simulator emits `groundTruth.anomaly_active` and `groundTruth.anomaly_type` per reading from the current injected scenario and its start tick. Door-open, compressor-drift and flatline labels begin when that scenario is injected, even while readings remain within 2–8°C; GPS labels apply only to samples where a GPS jump is injected. The AI feature scales are fit only on deterministic synthetic normal sequences. Its default score cutoff is calibrated on a separate held-out normal-only sequence set. The comparison script then recalibrates the cutoff on held-out simulator normal seeds that are disjoint from evaluation seeds. Evaluation labels never consult the policy threshold. Approved per-batch policy remains authoritative; AI labels and scores are advisory only.
- **Consequences:** These are synthetic injection labels, not independent sensor-fault or clinical ground truth. The edge-rule comparator uses documented fixed cutoffs. Results must disclose class balance, calibration/evaluation seed separation, normal false alarms, and scenario-specific failures; they must not be described as clinical validation.

### ADR-014 — Separate detector calibration and scenario evaluation

- **Status:** Accepted for Phase 10 (2026-10-07).
- **Context:** Detector scores depend on operating conditions, and a test set tuned to the policy threshold or used to select cutoffs would overstate performance. Compressor-drift onset, threshold breach, and detector alarm are distinct events.
- **Decision:** Fit the AI feature scales and calibrate its cutoff on deterministic NORMAL telemetry at original settings only. Calibrate the evaluation-only dimensionless edge comparator on separate held-out NORMAL seeds to a 1% sample false-alarm target. That comparator uses 2 consecutive positive scores to activate and 3 negative scores to clear; the real edge policy threshold remains immediate and unchanged. The AI advisory flag uses 2-of-3 persistence over its current and two immediately preceding raw scores. Evaluation and robustness seeds are disjoint from calibration. Report per-scenario run means and sample standard deviations, PR-AUC/ROC-AUC, prevalence-reweighted precision/F1, normal false alarms, and perturbation sensitivity.
- **Measurement definitions:** First-detection delay is elapsed time from the first injected ground-truth-positive sample to the first detector-positive sample at or after onset. First threshold breach is elapsed time from that same onset to the first sample outside 2–8 °C. Lead time is breach time minus detector time, computed per identical run; positive means the detector warned earlier. No pre-breach alarm yields no lead-time observation. Compressor drift is labelled active at injection, before it necessarily breaches policy, so detection delay and breach time are not interchangeable.
- **Measured outcome:** In the 30-run-per-scenario baseline, k-of-n reduced any-false-alarm normal runs from 28/30 raw to 11/30 persisted and sample FAR from 1.125% to 0.372%, while mean detection delay across 120 injected-anomaly runs increased from 92.0 to 159.5 seconds. Compressor-drift first threshold breach was 1,998 ± 28 seconds after injection; raw AI led it by 1,884 ± 95 seconds and persisted AI by 1,788 ± 94 seconds. Persisted AI F1 for GPS-jump labels was 0.010. Under the 10-second sampling robustness condition, normal sample FAR rose to 78.5%; at noise ×2 it rose to 46.9%. These are synthetic measurements and limitations, not operational performance claims.
- **Consequences:** All labels, perturbations, and measured results remain synthetic. Prevalence-reweighted statistics are mathematical operating-point estimates, not observed field prevalence. The edge and AI detections are advisory; approved batch policy remains authoritative. An advisory persistence flag may remain active for one to two samples after a raw score falls below cutoff.

The earlier ADR entries below preserve the decisions and assumptions made during each implementation phase. Where a consequence says a later feature was still future work, later accepted ADRs and the implementation docs supersede that historical note.

## ADR-008 — Root-only sensor evidence with a non-destructive companion

- **Status:** Accepted for Phase 5 (2026-10-06).
- **Context:** Existing immutable contracts lack root/transport methods and cannot be upgraded without a new deployment. Individual raw-reading transactions are costly; policy/AI updates must not invalidate sensor commitments.
- **Decision:** Keep the original batch address. Use an optional new companion for root metadata and structured transport lifecycle, with deterministic domain-separated SHA-256 proofs off-chain. Close fixed five-minute per-batch chunks at 100 readings or window end; late arrivals produce another chunk. Durably stage before acknowledging the Redis event and retry chain writes independently. Recompute raw leaves during verification, scope evidence APIs to the logged-in account, and disclose bounded verification. Legacy raw-writing mode remains explicit for compatibility. Unassigned shipment/vehicle/route IDs stay empty.
- **Consequences:** Two-contract lifecycle writes are not atomic. Companion commitment alone is not batch registration. Hardhat resets invalidate old receipts; no node recreation is part of this upgrade. Merkle integrity is not physical/clinical validation. New QR URLs point to the authenticated frontend page; older transaction-bearing URLs retain their original verifier. Failed-chain windows are a durable retry queue, not silently dropped.

## ADR-005 — Independent local groups and transactional policy outbox

- **Status:** Accepted for Phase 3 (2026-10-06)
- **Context:** AI/chain downtime must not block accepted telemetry or authoritative alerts. Existing dashboard queries and the local WebSocket publisher must remain compatible.
- **Decision:** Enable Redis Streams in Compose, preserving opt-out synchronous ingestion. Use one sequential loop per group in a single backend process. Keep TemperatureLog as the mutable unique projection, add a 90-day time-series measurement projection, initialize Mongo rs0 on the existing volume, and transactionally commit policy state/alerts/audit/outbox using Mongoose async-local sessions. AI enriches readings and never sets policy holds. Store retries and dead letters in Redis.
- **Consequences:** Receipts mean asynchronous acceptance, not completed alerts. Time-series deduplication assumes one persistence owner; multi-backend leases/distributed live delivery need more work. Long outages require DLQ replay after the retry budget. No stream compaction, migration, Merkle batching or restoration of volatile Hardhat history is claimed. Mongo-only seeded batches need existing manufacturer on-chain registration. See EVENT_BACKBONE.md.

This log records implementation assumptions for the synthetic software simulation. It is not a clinical or production system.

## ADR-001 — Correlation ID format and ownership

- **Status:** Accepted for Phase 1
- **Context:** The system currently runs telemetry over simulator-to-Express HTTP/MQTT, calls the advisory FastAPI service synchronously, persists to MongoDB, and uses a separate local-chain anchoring worker. A later Redis Streams phase must preserve trace identity across asynchronous consumers.
- **Decision:** Use a bounded opaque string called `correlationId`. Each simulator run gets a random UUID seed, and each reading gets a deterministic name-based UUID derived from that seed and tick index; the seed is checkpointed so retries and restored snapshots preserve the same event ID. HTTP uses `X-Correlation-ID`; MQTT carries the same ID in the envelope and telemetry body; backend records and downstream events persist/carry it. If an older client omits the ID, ingress creates one. Externally supplied IDs are accepted only when they match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; malformed values are replaced with a UUID. The AI HTTP call and response middleware propagate/echo the header. Structured request/processing logs include the ID when available.
- **Boundaries:** A correlation ID is observability metadata only. It is not an idempotency key, authentication credential, policy input, safety evidence, or authorization decision. Existing idempotency keys remain independently derived from telemetry identity. Records created before this change may have no correlation ID and remain valid.
- **Consequences:** The same ID is stored with a telemetry event, alert, audit, notification, optional email delivery, WebSocket event, and telemetry evidence digest. Redis event envelopes in a future phase should preserve this field without using it as a stream deduplication key.

## ADR-002 — Keep policy rules authoritative while adding tracing

- **Status:** Accepted for Phase 1
- **Context:** The project already evaluates approved batch-specific cold-chain policies and also calls an advisory anomaly service.
- **Decision:** Correlation plumbing must not change temperature thresholds, alert lifecycle, quarantine behavior, or advisory authority. AI remains additive and cannot create or clear a policy hold solely through this tracing change.
- **Consequences:** Tests and acceptance continue to exercise the existing alert workflow while asserting trace propagation. Any later separation into Redis consumers must preserve the same source-of-truth rule.

## ADR-003 — Add a separate Edge Gateway before the existing ingestion API

- **Status:** Accepted for Phase 2
- **Context:** The existing simulator can publish MQTT to a subscriber hosted inside Express or post directly to the backend. The target architecture calls for a distinct gateway boundary, but replacing the current ingestion route or changing policy behavior would break compatibility and expand the phase unnecessarily.
- **Decision:** Add a separately runnable Node/Express gateway that validates with the shared existing telemetry Joi schema, requires a gateway API key, forwards HTTP and MQTT readings to the existing authenticated backend endpoint, and carries the correlation ID. Retain the original backend endpoint and subscriber. An operator explicitly disables the backend MQTT subscriber when the gateway owns that broker topic.
- **Security and reliability boundaries:** HTTP uses loopback only unless HTTPS is configured for a remote upstream; embedded URL credentials are forbidden. MQTT requires TLS for a non-loopback broker. The MQTT gateway acknowledges only after the backend returns a record, but QoS 1 remains at-least-once and backend idempotency remains responsible for duplicate delivery. The gateway has no persistent local spool and its health endpoint is liveness only.
- **Consequences (historical Phase 2 baseline):** HTTP acceptance could exercise the separate process without a broker. Unit tests with an injected client did not prove a broker was running. **Current status:** Redis Streams and consumer groups were subsequently implemented (ADR-010); the deployed gateway now has Mongo-backed durable state and an ordered store-and-forward queue, not a filesystem-local spool. Phase 11 acceptance executed the live MQTT-to-gateway path and checked the stored edge flags. Mongo availability remains a dependency of that durable buffer.

## ADR-006 — Bounded synthetic analytics and review-only plan approval

- **Status:** Accepted for Phase 4
- **Context:** Historical demand was product-only, simple baselines lacked intervals, and the existing order planner did not use forecasts. Seed inventory has not passed manufacturing release gates.
- **Decision:** Retain legacy POST forecasts and pending-order planning. Add a synthetic-only, organization-scoped regional GET forecast using fixed SARIMA versus seasonal naive, a six-month chronological holdout, refit, prediction intervals and account-owned JSON exports. Missing months represent zero recorded demand and are disclosed; current partial month is excluded. Require 30 observed months. Use SciPy continuous LP plus checked whole-dose/greedy projection. Plan the first forecast month with immediate-arrival assumptions, shared regional/transport capacities, existing eligibility and a minimum shelf-life gate. Review approval is append-only, Admin-only and does not mutate stock; existing authorized order workflows still control physical allocation. Exclude non-synthetic inventory and unknown expiry.
- **Consequences:** Exact repeating seed data may give zero baseline errors and degenerate intervals; these are fixture properties, not evidence of real forecasting accuracy. Model selection and metrics share one holdout and are not independent evaluation. Fresh seed recommendations correctly show zero eligible stock until existing release workflows are completed. No public-chain, clinical, autonomous dispatch or replacement of policy alerts is introduced. The UI plans one selected series, while the API accepts multiple saved series. Forecast/plan validity is bounded to 24 hours and the current/future target month.

## ADR-004 — Reliable local Compose demo and seeded credentials

- **Status:** Accepted for Phase 1 reliable-platform work
- **Context:** The project needs a repeatable all-services local demo, while telemetry validation now rejects stale/far-future sensor clocks and broker, cache, chain, and email readiness must be independently visible.
- **Decision:** Define the Compose-only internal hostname allowlist explicitly; keep published ports loopback-bound; require authenticated Mosquitto and Redis; use Ethereal only as a disposable email capture transport; configure the seed password through local `.env`; and seed fixed synthetic accounts, batches, policy revisions, inventory snapshots, and generated monthly order fixtures. When a legacy telemetry client omits its timestamp, normalize it to receipt time. Use device ID plus sequence number as the idempotency identity, with `sensorId` retained only as a legacy identity alias.
- **Consequences:** Compose owns the local broker password file and its persisted volume. Seed logins all share the chosen `DEMO_SEED_PASSWORD`. **Historical status:** Redis Streams and consumer groups were subsequently implemented; see ADR-010 and `docs/EVENT_BACKBONE.md`. Real mail providers and any public blockchain remain out of scope.
## ADR-015 — Physical GPS plausibility and elapsed-time advisory features

- **Status:** Accepted, Phase 11 (2026-10-07).
- **Context:** A learned GPS displacement score and sample-count route/flatline/EWMA windows were sensitive to cadence; persistence hid sparse GPS injections. A jump's return transition was mislabelled as normal.
- **Decision:** GPS is haversine km divided by positive elapsed hours, flagging strictly above configurable `MAX_SPEED_KMH` (120 default). It bypasses statistical persistence, remains advisory, and reports computed speed. The simulator travels each route leg in twenty minutes at every cadence and labels both injected offset and return fixes, independently of speed. Temperature EWMA has tau `-60/log(0.7)` seconds; rolling context is 1,800 seconds; rates use adjacent 60-second bin means in C/min; flatlines use duration. Timestamped statistical warm-up is five minutes. Deployed ingestion forwards GPS and up to 1,000 timed context points to AI.
- **Calibration:** Fixed original synthetic settings only: training seed 90210, default calibration 90211, external calibration `phase11-cal-normal-*`; evaluation `phase11-eval-*` and all `phase11-robust-*` are disjoint. No retuning from robustness/evaluation results. Before/after metrics compare independent seed sets, not a paired causal experiment.
- **AI operating-point boundary:** Deployment retains the embedded Python-held-out-normal cutoff from seed 90211. The benchmark supplies one cutoff calibrated on ten disjoint simulator-normal runs, still at original settings; its precision/FAR describe that explicitly reported operating point. The API's default calibration metadata does not establish FAR for an externally supplied cutoff. No evaluation-seed tuning or deployment performance equivalence is claimed.
- **Explicit gateway difference:** Deployed `edge.localAlert` is the existing immediate local temperature-threshold advisory. Calibrated statistical cutoff with 2-positive/3-negative hysteresis remains evaluation-only. Both share time math and physical GPS rule. This is tested and reported in `edge.ruleProfile` and the results, not represented as deployment of the comparator. `rateOfChange` retains the legacy C/second field; the normalized field is `rateCPerMinute`.
- **Consequences:** Physical GPS overspeed is not proof of a faulty sensor; bad timestamps can also cause it. Humidity is explanatory, not part of the learned temperature score. All measurements remain synthetic and policy rules remain authoritative. Report every condition with pooled normal-sample FAR above 10%, and false advisory episode starts/hour (not positive samples) separately for raw/persisted output. No clinical or production claim follows from a green test suite.

## ADR-016 — Correct the platform smoke horizon without tuning the detector

- **Status:** Accepted, Phase 11 (2026-10-07).
- **Context:** The platform smoke evaluator expected compressor drift to breach 8 C after only 40 five-second samples (195 seconds), but the scenario slope is 0.18 C/min. A diagnostic run measured 2.04–2.69 C and no threshold breach; the smoke assertion was not testing its stated condition.
- **Decision:** Use 40 one-minute samples for this platform smoke scenario, backfill the entire horizon inside the existing 24-hour timestamp bound, and allow a 120-second reading gap for that cadence. Keep the approved 2–8 C limits, anomaly detector, held-out calibration/evaluation seeds and robustness experiment unchanged. Unit-test the smoke horizon and rerun the platform evaluation.
- **Consequences:** The corrected platform run exercises a real synthetic policy excursion. Its backfilled sensor timestamps and accumulated observation delay are not a live push-latency benchmark. Preserve the earlier failed drift classification as historical evidence; report the corrected artifact separately.
