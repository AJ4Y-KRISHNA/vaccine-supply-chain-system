# Correlation and Structured Logging

This feature belongs to the synthetic software simulation; it is not for clinical or production use.

No runtime dependency was added for Phase 1: tracing uses Node.js and Python standard-library facilities already present in the services.

## Behavior

- Every generated virtual-device reading receives a UUID `correlationId` derived from the simulator run ID and tick number. The run ID is checkpointed so a retried or restored tick preserves the original event ID.
- HTTP ingestion accepts `X-Correlation-ID`, returns it in that response header, and fills the same ID into readings that do not carry one. Existing simulator HTTP payloads also include the ID in the body.
- MQTT telemetry envelopes and payloads carry the same ID. The active consumer (legacy backend subscriber or optional Edge Gateway bridge) forwards it through the common ingestion API and includes it in the acknowledgement only after persistence. The message ID remains a separate transport/acknowledgement identifier.
- Mongo telemetry, telemetry state, policy alerts, cold-chain audit records, in-app notifications, and optional email-outbox rows retain the correlation ID. AI advisory requests forward it to FastAPI. Field Operator WebSocket reading/alert events and local-chain anchoring logs carry it.
- Backend request and processing logs are newline-delimited JSON objects. AI FastAPI request logs are JSON and include the request correlation ID. No authentication token, API key, MQTT password, or request body is logged by this feature.
- Legacy clients can omit the ID. The backend generates one; records already in MongoDB without it remain readable and anchorable.

## Verification

The backend unit suite checks ID validation, async context isolation, HTTP/MQTT propagation, AI request headers, anchoring digest coverage, and WebSocket event fields. The AI unit suite checks header echo/replacement on its HTTP middleware. `backend/scripts/runSystemAcceptance.js --execute` checks that Edge Gateway HTTP ingestion returns and persists a caller-supplied ID and that simulator-generated IDs reach alert and notification records in the isolated synthetic workflow. MQTT gateway acknowledgement behavior is unit-tested; live broker operation is not proved by that run.

Correlation IDs are trace metadata, never policy, safety, identity, or deduplication values. See [DECISIONS.md](DECISIONS.md#adr-001--correlation-id-format-and-ownership).
