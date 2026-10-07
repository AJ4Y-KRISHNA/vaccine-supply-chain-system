# Create a fresh vaccine batch

Software-only classroom demo. Use synthetic names and quantities; this is not clinical inventory or a medical approval workflow.

## User-input demonstration

1. Start MongoDB, the local Hardhat node, the deployed contract, the AI service, the Express backend and the React frontend as described in the README. Keep those terminals running. After backend code changes, restart the backend. Do not restart a running Hardhat node unnecessarily: its local chain state is temporary.
2. Open `http://localhost:3000` and sign in as **Manufacturer**. If another tab changed roles, sign in again. The backend assigns batch ownership from this account, not from an editable manufacturer name.
3. Click **Create New Batch** in the left sidebar, or **New batch** beside the dashboard title. Both open the same form above the dashboard cards.
4. Enter fresh data. For example: unique Batch ID `CLASS-DEMO-001`, product `Synthetic classroom vaccine`, quantity `100`, supplier `Classroom supplier`, material type `Synthetic material`, material quantity `100`, and unit `test units`. Choose an actual future expiry date. Remarks can say `Classroom demonstration only`.
5. Click **Create batch and report** once. Keep the page open while the backend records raw materials, production, batch registration, certificate and report through the existing manufacturing workflow.
6. Confirm the success panel and registration transaction hash. The dashboard refreshes automatically; the new batch appears in **Recent Vaccine Batches**, with its quantity, expiry and pending release stage.
7. For the existing release demonstration, use **Production Sign** and **Lab Sign** as separate actions. Creation never automatically approves or releases the batch. Existing role checks, quarantine holds and release conditions still apply.
8. To demonstrate sensor input for this fresh batch, scroll to **Virtual IoT simulator**, use **Refresh devices** if needed, and select the new batch. Simulator inputs also refresh periodically. Use a new device ID. Approved cold-chain policy and shipment assignment remain separate steps; the creation form does not invent a policy or create a shipment.

Use a new unique batch ID for each new batch, not to bypass an incomplete workflow.

## Validation and failure handling

- Required UI fields: batch ID, vaccine product, batch quantity, supplier, material type, material quantity, unit and expiry. Remarks are optional. Quantities must be positive safe whole numbers; expiry is the **beginning of the chosen date in UTC** and must be in the future.
- The server also validates inputs. Optional legacy API fields remain optional. Authentication, ownership, duplicate and cold-chain guards remain in effect.
- Double-clicking submit sends one request. Cancel is disabled during creation. Validation and known duplicate errors retain the input values for correction.
- An unavailable or misconfigured local blockchain is checked before operational writes. Fix the node/contract/writer configuration, then retry.
- MongoDB and blockchain writes are not one atomic transaction. If creation fails after it starts, or the response is lost, inspect saved batch/material/production/report records and chain transactions before recovery. The form blocks blind resubmission, and the server rejects IDs with partial manufacturing records. No automatic rollback or deletion is performed.
- If only dashboard refresh fails after creation, use **Refresh dashboard**; do not submit the batch again.
- Certificate confirmation failures are reported as warnings; an unconfirmed certificate is not marked minted on the batch.

## API and verification

The form uses the existing authenticated `POST /api/manufacturer/workflow`. It never sends editable ownership, release approvals or cold-chain overrides. The manufacturer dashboard response additionally provides account identity and batch expiry.

Automated coverage includes frontend form behavior and dashboard integration, isolated-Mongo workflow validation/authorization/retry tests, and an isolated real-chain creation/refresh/duplicate acceptance scenario in `backend/scripts/runSystemAcceptance.js`. Test databases are disposable; normal demo data is not reseeded or deleted.
