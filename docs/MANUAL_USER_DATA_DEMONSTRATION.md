# Manual user-data demonstration — role-based working model

This guide demonstrates how **user-entered synthetic data** moves through the existing application. Start from the current state: Docker services are running and Admin, Manufacturer, Distributor, Healthcare, and Field Operator sessions are already open. Do not re-login or restart the stack unless a session has expired.

> **Safety/scope statement:** This is a software-only academic demo. Use fictional batches, vehicles, organizations, orders, readings, and patient references only. It is not clinical or production software. The demo policy is not medical advice.

## What this demonstration proves

```text
Role enters synthetic data
        ↓
Role/authentication + validation + source/actor metadata
        ↓
Shared API and telemetry event pipeline
        ↓
MongoDB persistence → approved policy evaluation → alert/notification
        ↓                                      ↘ AI advisory (informational only)
        └──────────────────────────────────────→ local-chain Merkle evidence
        ↓
Role-scoped dashboard, source badge, chart/history and QR verification
```

For manual readings, the signed-in user is recorded as the actor; do not type an `enteredBy` value. `source` is recorded as `manual` or `csv`. The original reading is append-only: a correction creates a new reading that references the original.

## Role permissions at a glance

| Role | User-entered work to demonstrate |
|---|---|
| Admin | Manual reading, CSV reading import, batch/policy/alert administration, order review, inventory/admin workflows, readiness |
| Manufacturer | Create batch, add production/report inputs, production and lab release sign-offs, batch tracking and QR payload |
| Distributor | Assigned shipment steps, shipment events, manual reading, route and alerts scoped to assignment |
| Healthcare | Hospital vaccine order, CSV reading import, delivery receipt, QR verification, stock/administration/report workflow |
| Field Operator | Shipment-linked manual reading and operator-facing shipment/sensor history in the separate panel |

Permission notes: the manual-reading form is available to Admin, Distributor and Field Operator. Healthcare can import readings from CSV but cannot submit through that manual-reading form. Manufacturer is not authorized for the manual-reading endpoint. The backend enforces these permissions even if a client UI is manipulated.

## Part A — Best short demonstration: enter a manual reading and follow it

This is the recommended live demo because it begins with a real user input and makes the source visible. Use **Admin** for the entry so you can inspect all alerts afterward.

### 1. Select a batch and confirm its policy

1. In the **Admin** dashboard, refresh the page if needed.
2. Find the batch list / cold-chain policy area. Copy an actual batch ID shown in the dashboard; do not guess an ID.
3. Confirm that the selected batch has an **approved** policy. Use its displayed limits in the next step. If no policy is approved, choose another seeded batch or stop and explain that policy alerts require an approved policy; do not invent one during the demo.
4. Keep the batch ID and permitted temperature range visible or write them down for the form.

### 2. Enter one synthetic reading

1. In Admin, open **Manual / CSV telemetry**.
2. Enter these example values, replacing `BATCH_ID_FROM_DASHBOARD` with the exact batch ID from step 1:

   | Form field | Example input | Notes |
   |---|---|---|
   | Batch ID | `BATCH_ID_FROM_DASHBOARD` | Must be a real batch in this demo database |
   | Vehicle ID | `VIVA-TRUCK-01` | Fictional vehicle identifier |
   | Temperature (°C) | `11` | Demonstrates an excursion only if this is above the selected batch's approved maximum |
   | Humidity (%) | `58` | Synthetic sample value, 0–100 |
   | Battery (%) | `92` | Synthetic sample value, 0–100 |
   | Latitude | `9.9312` | Fictional/simulated Kochi-area coordinate |
   | Longitude | `76.2673` | Fictional/simulated Kochi-area coordinate |
   | Timestamp | Leave the current-time default | Must not be future-dated |
   | Operator note | `Synthetic viva test reading; not clinical data` | Required audit note |

3. Read the values back before submitting. Click **Submit reading** once.
4. Wait for the success message. If it says **queued**, allow the worker/stream consumers time to process it; then use **Refresh dashboard** or refresh the view. Do not submit repeatedly because the page has not updated yet.

### 3. Follow the saved reading to its alert and chart

1. In Admin, open the temperature/alert area and refresh it.
2. Find the newest reading/alert by timestamp and batch. Verify the reading shows **Manual** source, not Simulated.
3. Confirm the alert's measured temperature, actual allowed range, policy reason, timestamp and any available location/vehicle context.
4. Open the batch's sensor history/chart. Confirm the new point is included and has the Manual source marker/badge where displayed.
5. If the system displays an AI explanation, identify it as **advisory**. The approved batch policy determines whether a cold-chain event opens; AI does not replace or overrule that policy.
6. Explain that an initial brief excursion may be a review-required warning. It is not necessarily an immediate quarantine. Sustained exposure, sample timestamps, and policy duration govern escalation/hold behavior.

**Expected path:** the signed-in Admin creates a validated manual record; the backend records source and actor; the telemetry enters the shared pipeline; persistence and approved-policy evaluation run; the dashboard/chart and relevant notifications update; eligible sensor evidence is staged for local-chain anchoring.

**If there is no alert:** verify that the chosen batch has an approved policy and that the temperature is outside its actual limits. Wait for the asynchronous consumer and refresh. Never claim an alert was created unless it appears in the application. The reading may be stored with `POLICY_NOT_APPROVED` when no approved policy exists.

### 4. Check other roles without overclaiming visibility

1. Switch to the **Manufacturer** session and refresh. Show the reading/alert only if that batch belongs to this manufacturer.
2. Switch to **Distributor** and refresh. It sees alert records only when the alert is associated with an assigned/matching shipment.
3. Switch to **Healthcare** and refresh. It sees records only for its accessible batch/order/shipment scope.
4. If a role does not show the alert, explain that organization and shipment scoping is expected. Do not change assignments or claim every role receives every alert.
5. In **Field Operator**, show the matching shipment/sensor view if the batch is accessible. The Field Operator form itself derives the batch and shipment from the selected shipment.

In-app alert notifications are always the core notification path. Email, if captured, is an Ethereal test preview and is not sent to a real person.

### 5. Verify the QR and chain status

1. In Manufacturer, open the batch row and select **Show batch QR** if available.
2. In Healthcare, open **Verify batch QR**. Use the camera only if the browser supports it and permission has already been granted; otherwise paste the verification URL or enter the batch ID.
3. Read the result carefully. Report two separate things: whether batch identity is verified, and whether sensor evidence is `yes`, `pending`, or unavailable.
4. If it is pending, wait for the demo Merkle window (30 seconds in Compose) and refresh/check again. If the batch has no anchored sample, state that the QR currently verifies batch identity only.

The local-chain root is an integrity commitment, not proof of vaccine safety, physical measurement, or regulatory compliance. Restarting the in-memory Hardhat node loses its chain history.

## Part B — Demonstrate CSV as a second user-entered source

Use this if you want to show a human-prepared file being validated row by row.

1. Sign in as **Admin** or **Healthcare** (CSV reading import is authorized for these roles).
2. Open **Manual / CSV telemetry** and click **Download CSV template**.
3. Keep the supplied header names exactly:

   ```csv
   batchId,vehicleId,temperature,humidity,battery,lat,lon,timestamp,note
   ```

   Optional columns are `shipmentId` and `deviceId`. Use a real batch ID from the dashboard, current/past ISO timestamp, valid numeric ranges, and a synthetic note. Example row (replace the batch ID):

   ```csv
   BATCH_ID_FROM_DASHBOARD,VIVA-TRUCK-CSV-01,5.2,58,92,9.9312,76.2673,2026-10-07T10:30:00.000Z,Synthetic CSV demonstration reading
   ```

4. Save as `.csv`, select **Upload CSV (max 5,000 rows)**, and choose the file.
5. Show the accepted/rejected totals and per-row result table. Explain that invalid rows are reported with reasons and valid rows are queued in timestamp order.
6. Refresh the reading history/chart and show the **CSV** source badge/marker.

Do not upload a spreadsheet containing real clinical, patient, or personal information.

## Part C — Optional full order-to-delivery model using entered data

This is longer and requires a batch that has completed production/report and release checks. A seeded batch may be unreleased; if so, do not bypass that safeguard. Prepare this workflow before the presentation if you need to show it end to end.

1. **Manufacturer:** select **Create New Batch**. Enter a new unique synthetic Batch ID, product name, positive batch quantity, supplier, material type/quantity/unit, a future expiry date and a demonstration-only remark. Click **Create batch and report** once; wait for the success response and registration hash.
2. **Manufacturer:** locate the batch and complete **Production Sign** and **Lab Sign** as separate actions. Show the resulting release stage. A created batch is not automatically released.
3. **Admin/designated reviewer:** confirm an approved cold-chain policy exists for the batch. Policy approval is a distinct audited action and only a designated reviewer may perform it. Use a fictional demo policy/reference, never represent it as a real medical standard.
4. **Healthcare:** open **Workflow** and submit a synthetic vaccine order with a vaccine type, region, positive whole-number quantity, priority and synthetic note. The hospital identity is tied to the signed-in account.
5. **Admin:** open the order queue, review the requested amount, approve it using eligible released stock, and assign the correct distributor. Approval creates the assigned shipment; do not create a duplicate shipment.
6. **Distributor:** refresh and open **Shipments**. For the assigned eligible shipment, use the offered progression: **Verify batch → Dispatch shipment → Supply hospital**. Backend checks may block an ineligible, held, unreleased, mismatched, or over-capacity shipment. Explain a block rather than bypassing it.
7. **Healthcare:** refresh, open **Deliveries**, enter an optional synthetic receipt note, then select **Confirm Received** once.
8. Show the received shipment and resulting stock/history. Inventory is derived from confirmed receipts; do not type stock into a generic field to fake a delivery.

Optional Healthcare vaccination/report workflow must use an invented patient/reference and only after a valid confirmed receipt. Do not use real patient information. It is not necessary to demonstrate the cold-chain alert pipeline.

## Optional correction: preserve the original record

If demonstrating correction, use the authorized correction flow/API for Admin, Distributor or Field Operator. Enter a reason and show that correction creates a new record with a `supersedes` reference. The original telemetry record is not edited or deleted. Do not correct a reading by directly editing MongoDB; that would invalidate audit/chain evidence.

## Presenter talk track: where user data goes

Use this short explanation while moving through the screens:

1. “The operator enters a measurement and note; the server records the authenticated actor and source.”
2. “The service validates ranges and timestamps, then queues accepted telemetry for the worker pipeline.”
3. “MongoDB stores the reading and location. The approved batch policy evaluates it and creates an explainable policy event when conditions match.”
4. “The notification outbox sends role-scoped in-app messages and attempts a disposable test-email capture.”
5. “The AI service adds an advisory explanation. It is not the authority for a safety hold.”
6. “The anchoring consumer groups readings into a Merkle window and commits an integrity root to the local Hardhat chain; the Healthcare verification view checks proofs when evidence is available.”
7. “Dashboards query scoped records and show provenance—Manual, CSV, or Simulated—so the audience can distinguish user input from generated data.”

## Stop conditions and common issues

| What you see | What to do / say |
|---|---|
| Reading form rejects the input | Check required note, exact existing batch ID, numeric ranges and non-future timestamp. Correct the form; do not claim it was saved. |
| Reading queued, but no chart/alert yet | Wait briefly for consumers, then refresh. A queued response is not proof of downstream completion. |
| Reading saved but no alert | Confirm batch has an approved policy and value breaches that batch's actual limits. A missing policy does not mean the reading is safe. |
| Other role cannot see the alert | Check batch ownership and shipment/distributor/hospital assignment. Role scoping can make absence correct. |
| QR says pending or batch-only | Wait for anchoring or state accurately that only batch identity is verified. Do not claim a sensor proof. |
| Order/shipment action is blocked | Check batch release, policy/hold status, assignment, available quantity and workflow stage. Preserve the backend guard. |
| UI appears stale | Use the page's **Refresh dashboard** control or reload that page. Avoid restarting Hardhat. |

If services need diagnosis, from the repository root:

```powershell
docker compose ps
docker compose logs --tail 80 backend worker edge-gateway ai-service
```

Never show `.env` or passwords in the recording. Avoid `docker compose down -v`: it deletes persistent demo volumes. `docker compose down` also stops the in-memory local chain, so its old transaction history will not survive the next start.

## Final disclosure

Close with: “This prototype demonstrates data entry, validation, policy-based alerting, role-scoped review and local integrity anchoring using synthetic records. It does not establish clinical safety, field-device accuracy, public-chain immutability, production availability or real-world forecasting accuracy.”

## Project references

- [Phase 3B manual-entry scope and permissions](PHASE_3B_MANUAL_ENTRY.md)
- [Current project implementation](CURRENT_STATE.md)
- [Manual dashboard component](../frontend/src/components/ManualReadingEntry.js)
- [Reading route permissions](../backend/routes/readingRoutes.js)
- [Policy alerts and review](TEMPERATURE_ALERTS.md)
- [Manufacturer batch creation](MANUFACTURER_BATCH_CREATION.md)
- [Distributor and Healthcare lifecycle](OPERATIONAL_DASHBOARD_GUIDE.md)
- [QR verification details](TRACEABILITY_AND_DEMO_FEATURES.md)
- [Final freeze/evaluation limitations](PHASE11_FREEZE.md)
