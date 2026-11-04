# Distributor and healthcare demonstration

This is a software-only, synthetic-data prototype. Use invented patient references, never clinical patient details. Run MongoDB, the local blockchain/deployed contract, backend, AI service and frontend before the demonstration. Restart the backend after changing its source.

## User-input flow

1. A manufacturer creates a fresh batch and completes the existing production and lab sign-offs. A batch must have its report and release approval before distribution; expired or quarantined batches remain blocked.
2. The hospital opens **Workflow** and enters a vaccine type, region, positive whole-number requested doses, priority and optional notes. Hospital identity comes from the signed-in account, not editable demo defaults.
3. An admin approves the order with eligible stock and a distributor assignment. Approval creates the assigned shipment; the distributor should not create another shipment for the same allocation.
4. The distributor selects **Refresh dashboard**, then **Shipments**. Each shipment exposes its next action: **Verify batch → Dispatch shipment → Supply hospital**. Product, release, ownership, quantity and cold-chain checks are performed by the backend. A held shipment shows the quality-review requirement instead of an action.
5. Before receipt, open the Manufacturer's batch row and select **Show batch QR**. In the signed-in Hospital dashboard, open **Verify batch QR**, choose **Start camera scan**, allow camera access and scan the code. If the browser does not support QR detection, enter the batch ID or paste the verification URL. Confirm the returned batch ID, vaccine, quantity and **verified on the local blockchain** result. The hospital must have existing access to that batch; an unknown/unregistered chain record must fail verification.
6. The hospital selects **Refresh dashboard → Deliveries**, optionally enters a receipt note, then selects **Confirm Received**. Receipt is allowed only after supply/delivery and adds the shipment quantity once.
7. In **Vaccinate**, select the confirmed batch, enter an invented patient/reference, the number of doses used, and a reporting authority. Select **Record vaccination and report**. Stock is calculated from confirmed shipment receipts and prior administrations. The form cannot invent received stock or overwrite the hospital's stock balance.
8. Select **Reports** to inspect the individual request, inventory snapshot, administration and report records. Use **Export workflow** for a CSV. Distributor **Export Report** exports the current filtered shipment table.
9. Use **Feedback → Add Feedback** to enter synthetic feedback, batch, category, severity and a non-future observation date. Analytics consent starts unchecked. Feedback history refresh and submission failures are visible.

## Navigation and interpretation

- Sidebar items navigate to actual page sections. Logout clears the application's active session.
- Shipment search filters by shipment, batch, vaccine, destination and status.
- The destination diagram is illustrative, **not live GPS tracking**. Unknown destinations share the central marker. Virtual sensor coordinates remain in the cold-chain telemetry interface.
- Shipment activity counts status events; it is not a claim that every event is a completed delivery.
- Appointments remain a read-only empty section when the backend has no appointment records. No scheduling capability is implied.

## Interrupted operations

Refresh and inspect saved records after an uncertain error. Do not enter another administration merely to retry its blockchain/report step.

The vaccination form stores only a SHA-256 input hash and operation identifier in the browser, not the patient/reference text. An unchanged interrupted submission reuses the identifier across reloads. The backend returns an already-completed result without another stock debit, or rejects a partially recorded operation with `VACCINATION_OPERATION_INCOMPLETE`. A confirmed successful response clears that browser identifier so the next deliberate new administration can proceed.

MongoDB writes and local-blockchain transactions are not one distributed transaction. A partially completed vaccination requires inspection/reconciliation of its existing administration and report; the prototype does not silently administer again or claim automatic rollback. Supply and receipt retries reuse shipment-keyed records, and a receipt is not marked confirmed until its inventory and notification exist.

## API compatibility and safety

Existing endpoint URLs remain. Distributor progression uses `verify`, `status` (`In Transit`), `supply`, and healthcare `confirm` actions. Arbitrary status strings and backward transitions are rejected. The legacy vaccination inventory endpoint returns an existing confirmed shipment receipt instead of accepting invented stock. Legacy record creation routes through the same administration/report/inventory checks. New vaccination callers should send a unique `operationId`; legacy callers without it still receive stock checks but do not gain keyed replay protection.
