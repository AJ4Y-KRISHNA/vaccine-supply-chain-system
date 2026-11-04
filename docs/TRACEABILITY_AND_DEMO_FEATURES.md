# Traceability and presentation tools

These additions reuse the existing batch, order, shipment, temperature-log, cold-chain alert, vaccination, and policy records. The local contract now also stores append-only sensor readings and status history; all data remains synthetic/demo and non-clinical.

## Live shipment visualizer

The read-only /api/live-shipments endpoint requires authentication and applies the existing organization scope to shipments, batches, and telemetry. It returns no more than 100 records and supports an optional shipment identifier; a deep link to a shipment outside the caller scope returns 404. The latest sensor record is joined by exact shipment identifier only, and policy limits come only from the batch approved policy reference. Related alert details are fetched through the existing role-scoped alerts endpoint.

Admin and Distributor dashboards show three lanes; the dedicated /live-shipments view and Admin manual-simulator console link to the selected shipment detail. Truck position maps saved workflow status and does not move on a timer. Coordinates are labeled simulated GPS. Red represents a recorded quarantine/quality hold, amber a policy excursion, unresolved alert, or critical battery condition, green readings within configured limits, and gray missing policy/telemetry. The UI is explicitly marked Simulated, pauses polling in hidden tabs, and respects reduced motion. This is not a safety determination.

## Batch Story: shipment journey and sensor history

Each role dashboard now includes **Batch Story**. The batch list and story endpoint apply the signed-in user's organization scope. The view assembles existing records without creating a second copy: batch metadata and terminal disposition; linked hospital orders; every persisted temperature/sensor reading and its stored evaluation result (including normal results); approved policy versions and limits; visible explainable alerts and append-only quarantine/review audit actions; shipment status transitions; delivery and administration records; stored transaction hashes; and available local-contract lifecycle events. Events are ordered from oldest to newest, with timestamps and responsible role/organization when those are recorded. Patient names are intentionally omitted.

The existing sensor chart plots the full persisted temperature history and, only when an approved `ColdChainPolicy` exists, the currently attached minimum and maximum limits. Historical alert records retain their policy snapshot; normal temperature-log evaluations do not persist a policy-version identifier, so the current chart limits must not be interpreted as the exact historical limits for every point. Policy approval, alert-opened, quarantine, and recovery points are marked when an event and a corresponding reading exist. Humidity, battery, and simulated GPS are summarized alongside the graph. If the batch has no approved policy, the display does not invent temperature limits. Production sign-off fields, certificate/forecast context, and the full contract lifecycle are returned only to admin and the owning manufacturer. Distributor and hospital responses contain only records within their shipment/order scope; hospital responses do not include manufacturer-only production internals. The endpoint is read-only. A local-chain outage does not prevent MongoDB history from being shown.

Endpoints:

- `GET /api/traceability/batches`
- `GET /api/batches/:batchId/story` (primary Batch Story endpoint)
- `GET /api/traceability/batches/:batchId` (compatible alias)

All require an authenticated user. The backend returns `404` for batches outside the user's role/organization scope. Blockchain transaction hashes are displayed as stored references; lifecycle-to-transaction matching is explicitly labeled as inferred by existing label correlation and is not proof that a specific lifecycle event emitted that transaction.

## Batch QR verification

Each manufacturer batch row loads a verification payload from `GET /api/batches/:batchId/verification-payload`. When an on-chain sensor reading exists, the QR contains the protected verification path plus local chain ID, contract address, batch ID, raw record ID and SHA-256 field commitment. The Hospital dashboard's **Verify batch QR** section reads it with the browser's native `BarcodeDetector` where available; users can also paste the full URL. The client parses the batch identifier and proof, then calls the configured backend through the normal authenticated API client—it does not fetch an arbitrary URL from a scanned code. The backend compares the proof to the reading retrieved from the configured local contract and existing batch-read scope applies. A QR generated before the first chain reading is explicitly labeled batch-only; manual batch-ID entry also verifies batch identity only. `GET /api/batches/:batchId/on-chain-telemetry?offset=0&limit=100` and the Blockchain Audit panel expose paginated raw history directly from contract state. This is a local demonstration-chain proof, not external regulatory, clinical, or public-chain verification.

Evidence: `frontend/src/components/BatchVerificationQr.js`, `frontend/src/components/BatchVerificationPanel.js`, `frontend/src/services/blockchain.js`, `frontend/src/pages/ManufacturerDashboard.js`, `frontend/src/pages/HospitalDashboard.js`, and the protected route/controller `backend/routes/batchRoutes.js` / `backend/controllers/batchController.js`.

## Guided demo mode

The Admin dashboard's **Guided demo mode** generates a new synthetic batch ID, sensor device ID, and order-notes reference. It stores only this guide bundle in browser local storage. It never inserts, overwrites, or deletes supply-chain records. Complete the real role-dashboard forms and use **Refresh progress** to check durable records. Put the supplied order reference into the Hospital order notes so the guide can find the new order; Admin order review then associates it with the generated batch.

Use a unique synthetic vaccine label and future expiration date. Run a simulator tick with the generated device ID. An approved batch policy is required before the rule engine can create policy alerts or quality holds. The statistical outlier inference runs separately when there is enough prior same-device history and remains advisory; neither result is a clinical conclusion.

## Local-system readiness

The Admin dashboard's **Local-system readiness** panel reports the API response, MongoDB connection state, loopback local blockchain reachability, and whether the configured contract/ABI are present. `GET /api/admin/readiness` returns status booleans/enums only; it does not return the contract address, RPC URL, ABI contents, or private keys. The probe intentionally blocks non-loopback blockchain endpoints.

## Reviewer permissions

The Admin dashboard's **Audited reviewer permissions** lists admin and manufacturer accounts and their `canReviewColdChain` capability. An administrator can designate or revoke a capability only after entering a reason. Disabled accounts cannot receive access, and the final active reviewer cannot be removed. Permission changes append `GRANT_REQUESTED`/`GRANT_APPLIED` or `REVOKE_REQUESTED`/`REVOKE_APPLIED` records to the append-only reviewer audit collection.

Endpoints:

- `GET /api/admin/cold-chain/reviewers`
- `PATCH /api/admin/cold-chain/reviewers/:userId` with `{ "canReviewColdChain": true, "reason": "..." }`

These endpoints are administrator-only. Reviewer access is checked against the current database user record, so permission revocation takes effect on the next request without issuing a new JWT.
