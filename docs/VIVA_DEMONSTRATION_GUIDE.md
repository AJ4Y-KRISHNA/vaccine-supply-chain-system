# Viva demonstration guide — Vaccine Cold-Chain System

**Use this guide when the Compose demo is already running and you are signed in to all role dashboards.** It gives an ordered presentation script, including what to click, what to say, what result to expect, and which limitations to state honestly.

> **Scope:** This is a synthetic software simulation. There is no physical sensor, real vehicle, clinical vaccine, real patient record, public blockchain, or production email. Use invented demonstration data only.

## Presentation plan (about 10–15 minutes)

| Time | Demonstration |
|---|---|
| 1 min | Introduce the system and its synthetic-only scope |
| 2 min | Admin readiness, batches, approved policy, inventory and analytics |
| 2 min | Manufacturer batches and the release workflow |
| 2 min | Normal simulated sensor and route |
| 2 min | Manual out-of-policy reading and policy alert |
| 2 min | Role notifications, chart/history and QR verification |
| 2–4 min | Optional order-to-delivery workflow and saved acceptance/evaluation evidence |

## Before you start presenting

1. Keep the terminal that started Compose open. In a separate PowerShell window at the repository root, check that services are still up:

   ```powershell
   Set-Location "D:\proejcts\vaccine-supply-chain-system"
   docker compose ps
   ```

   Services should be running/healthy. If something is unavailable, inspect logs before changing or reseeding anything:

   ```powershell
   docker compose logs --tail 80 backend worker edge-gateway ai-service
   ```

2. Keep the role sessions open. Recommended browser setup: use separate browser profiles/windows so each role stays signed in independently. The Field Operator uses the separate panel at `http://localhost:5173`; the other roles use `http://localhost:3000`.
3. The five demo accounts share the private `DEMO_SEED_PASSWORD` from the root `.env`. Do not put the password on the projector or in screenshots.
4. If a page looks stale, use that dashboard's **Refresh dashboard** or refresh the page. Do not restart Hardhat during the demo: it is an in-memory local chain, and restarting it loses the current chain history.

## Opening statement

Say:

> “This is a software-only synthetic demonstration of vaccine cold-chain monitoring. The simulator creates fictional sensor and route data. Approved batch policy rules determine policy alerts; the AI module provides a separate advisory explanation. This is not a clinical or production system.”

## Step 1 — Admin: show system health and the seeded data

1. Switch to the **Admin** session.
2. Open **Local-system readiness** and show the API, MongoDB, MQTT, Redis, AI service, local chain/contract and email-capture statuses.
3. Say that the chain is a local Hardhat development chain and that the email provider captures test messages; neither is a public chain or a real-recipient email service.
4. Show the batches and their approved demo policies. Select one existing batch whose policy is approved. Read the range from the screen; the seed normally uses a demo 2–8 °C policy. Call it a demo policy, not a medical standard.
5. Show inventory and **Forecast Analytics**. Point out the synthetic-history/provenance label.
6. Open **Supply Planning** and show its assumptions/recommendation preview. It is a review-only recommendation; it must not automatically dispatch stock.

**Expected:** The readiness panel reports statuses without displaying secrets. Batch, policy, inventory, forecast and plan values are displayed from the demo application data.

**Be accurate:** Seeded batches are not manufacturing-released. The verified fresh-seed supply plan returned zero allocation and preserved stock. Do not present zero as a software failure or claim a positive allocation from unreleased seed stock.

## Step 2 — Manufacturer: show batch traceability

1. Switch to the **Manufacturer** session.
2. Show the batch list, batch history, production/report information and the available analytics/alerts.
3. If you want to demonstrate batch creation live, select **Create New Batch** (or **New batch**) and use only synthetic values. Example:

   | Field | Demo value |
   |---|---|
   | Batch ID | A new unique value such as `VIVA-DEMO-20261007-01` |
   | Product | `Synthetic classroom vaccine` |
   | Quantity | `100` |
   | Supplier | `Classroom supplier` |
   | Material type | `Synthetic material` |
   | Material quantity / unit | `100` / `test units` |
   | Expiry | A real future date |
   | Remarks | `Synthetic viva demonstration only` |

4. Submit **Create batch and report** once. Wait for the result and registration hash. Do not double-submit if the page is slow; refresh and inspect the saved batch first.
5. Demonstrate **Production Sign** and **Lab Sign** as separate steps if those controls are available. Creation does not itself release the batch. Distribution requires the existing production/report/release checks and an approved policy; do not bypass them for the presentation.
6. If you just need to show sensor monitoring, use an existing seeded batch with an approved policy instead of introducing a new batch whose policy/release workflow is incomplete.

**Expected:** A new synthetic batch is recorded and appears with its pending/release stage. Production and lab sign-offs remain distinct actions.

See [MANUFACTURER_BATCH_CREATION.md](MANUFACTURER_BATCH_CREATION.md) for the full form rules and recovery guidance.

## Step 3 — Admin or Manufacturer: show normal simulated telemetry

1. Return to the **Admin** session, or use the Manufacturer session if it owns the selected batch.
2. Open **Virtual IoT simulator** and select **Refresh devices**.
3. Choose an existing batch that has an approved policy. If there is no suitable virtual device yet, create one with:
   - a new device ID (for example `VIVA-IOT-01`),
   - a synthetic vehicle ID (for example `VIVA-TRUCK-01`),
   - the selected batch,
   - a fixed seed such as `viva-20261007-01`,
   - scenario `NORMAL`,
   - current ISO start time (the default is suitable),
   - a tick interval such as `5000` ms,
   - generator range such as 2–8 °C.
4. Click **Create virtual device**, then **Tick once** (or **Start** to show repeated samples).
5. Show the saved temperature, humidity, battery/GPS context, history chart and route/map panel. Identify the map coordinates as simulated.

**Expected:** A synthetic reading is saved and shown in the dashboard/history. The gateway prefers MQTT and forwards to the backend; the backend validates and stores the reading and applies the approved policy.

**Note:** Simulator generator range is not the approved safety policy. Do not change the policy just to make a scenario appear normal.

## Step 4 — Admin or Distributor: create a manual alert example

This is the most predictable visual alert step because one out-of-policy sample is enough to create a policy event for review. The manual form is available to Admin, Distributor and Field Operator roles; Healthcare can import CSV but cannot submit a manual sensor reading through this form.

1. In **Admin** (recommended) or **Distributor**, find **Manual / CSV telemetry**.
2. Enter the ID of the selected existing batch with an approved policy. Copy the ID exactly from the batch list; do not guess it.
3. Enter a synthetic vehicle ID (for example `VIVA-TRUCK-01`).
4. Enter a temperature above that batch's displayed approved maximum—for the seeded 2–8 °C demo policy, use `11` °C. Use plausible synthetic values for humidity, battery, latitude and longitude. Leave the timestamp at the current time.
5. Enter this note: `Synthetic viva test reading; not clinical data`.
6. Click **Submit reading** once. Wait for the status message indicating the reading was queued. If it is asynchronous, refresh the dashboard after a short wait.
7. Open the alert/temperature panel and show the event reason, reading value, policy range, source (`Manual`), timestamp and available batch/shipment context.

**Expected:** The manual reading enters the shared validation/stream/persistence/policy path. An out-of-policy reading opens a review-stage policy event and notification. The AI explanation, when present, is separately labelled advisory. A single brief excursion does not necessarily quarantine the batch; sustained exposure and review rules are separate.

Do not claim the alert is visible to every role automatically. Distributor and Healthcare notification visibility depends on the alert's linked shipment and matching organization assignment. Admin can inspect all alerts; Manufacturer visibility is scoped to the owning manufacturer.

## Step 5 — Show the simulator's door-open scenario (optional)

1. In **Virtual IoT simulator**, use the scenario selector for the selected device and choose `DOOR_OPEN`.
2. Use **Tick once** or **Start**, then show the changed synthetic temperature and resulting policy evaluation when it appears.
3. Keep the batch's approved limits visible. Explain that the policy engine—not the AI model—decides policy alerts and holds.
4. If the alert does not appear immediately, do not claim it failed or invent a result. The sustained-excursion rule depends on the approved policy duration and timestamped readings. For a short viva slot, use the manual 11 °C example in Step 4 for the immediate review event.
5. Optionally switch back to `NORMAL` and generate a fresh reading. Normal recovery closes measured excursion evidence but does not automatically clear a quarantine hold; an authorized review/clear workflow is required for a hold.

The simulator has separate `NORMAL`, `DOOR_OPEN`, `COMPRESSOR_DRIFT`, `SENSOR_FLATLINE`, `GPS_JUMP` and `LINK_LOSS` profiles. `LINK_LOSS` demonstrates a synthetic gateway-forwarding interruption and store-and-forward recovery, not a physical network outage.

## Step 6 — Show role-scoped views

Use the already signed-in role sessions; refresh each dashboard before narrating.

### Admin

- Show readiness, the full alert list, approved policy, inventory, analytics and audit/history sections.
- Open the alert and point out the stored policy reason and sensor source.
- If an authorized alert-response action is shown, explain that acknowledge/action/review/clear steps require their notes and permissions. Do not clear or quarantine an alert unless you intend to alter the demo state.

### Manufacturer

- Show owned batches, batch lifecycle, shipments/alerts and analytics.
- Use **Show batch QR** on a batch row when that action is available; explain whether the payload includes sensor proof or is batch-only.

### Distributor

- Show assigned shipments, shipment status, route context and scoped alerts.
- The supported progression is **Verify batch → Dispatch shipment → Supply hospital**. Use it only for an eligible assigned shipment with a released batch and no active cold-chain hold. Do not create a second shipment for an order that Admin already allocated.

### Healthcare

- Show requested/received vaccine workflows, delivery/history and **Verify batch QR**.
- Use an accessible batch/verification URL. If a camera scan is not supported by the browser, paste the verification URL or enter the batch ID. State clearly whether you verified batch identity only or anchored sensor evidence as well.
- If an eligible delivery was supplied, use **Confirm Received** once. Do not enter real patient information; vaccination/reporting controls should only use invented references and should be skipped unless specifically needed for the viva.

### Field Operator

- Show the separate panel at `http://localhost:5173`, the assigned shipment and its sensor/history view.
- If demonstrating manual input here, choose the shipment and submit only a synthetic reading with an explanatory note.

**Expected:** Each role sees only the records permitted by its organization/assignment scope. An absent alert in a role tab may be correct if that role is not a matching recipient.

For the exact order-to-delivery workflow, see [OPERATIONAL_DASHBOARD_GUIDE.md](OPERATIONAL_DASHBOARD_GUIDE.md). That full workflow requires an eligible released batch, order approval and distributor assignment; it is longer than the core sensor-alert demonstration.

## Step 7 — Show QR and blockchain evidence

1. In Manufacturer, open **Show batch QR** for a batch with an available verification payload.
2. In Healthcare, open **Verify batch QR** and scan, paste the verification URL, or enter the batch ID if camera detection is unavailable.
3. Read the result as two separate claims:
   - batch identity verification; and
   - sensor evidence anchored: yes, pending, or unavailable/no proof.
4. If the evidence is pending, wait for the configured demo Merkle window (30 seconds in the Compose demo) and refresh/check again. Do not describe pending evidence as anchored.
5. If the selected batch has no anchored reading, say so and select a batch that does. A batch-only QR does not prove temperature history.

**Expected:** A successful anchored verification compares the off-chain reading proof to a root on the local Hardhat chain. That root establishes integrity of the committed data; it does not establish vaccine quality or prove that a physical sensor collected the data.

## Step 8 — Optional: demonstrate order and delivery lifecycle

Do this only if you have a released, eligible batch and enough presentation time.

1. **Healthcare:** open **Workflow**, submit a synthetic vaccine order with region, positive whole-number dose quantity, priority and a clearly synthetic note.
2. **Admin:** review the order, approve it using eligible stock and assign the correct distributor. Approval creates the assigned shipment.
3. **Distributor:** refresh, open **Shipments**, then perform the available sequence **Verify batch → Dispatch shipment → Supply hospital**. Pause if the backend reports a release, policy, ownership, quantity or cold-chain hold; explain the guard rather than bypassing it.
4. **Healthcare:** refresh, open **Deliveries**, optionally enter a synthetic receipt note and select **Confirm Received** once.
5. Show the resulting received record/history. Do not invent hospital stock by editing an inventory field; the workflow derives stock from confirmed receipts.

Seeded batches are not released, so a fresh seed may correctly block this lifecycle. If you did not complete the authorized manufacture/release workflow beforehand, present the steps and show the existing dashboard state without pretending a delivery succeeded.

## Step 9 — Optional terminal proof

Run these only if you have time, and preferably before the live presentation because they add uniquely named synthetic evidence and wait for external test-email capture:

```powershell
node .\scripts\acceptance.js
```

To display the already generated AI/threshold evaluation report without rerunning the experiment:

```powershell
Get-Content .\results\ai_vs_threshold.md
```

The longer evaluation command is optional and can take significant time:

```powershell
node .\scripts\evaluate.js
```

When presenting its results, call them synthetic benchmark measurements. Explain that calibration and evaluation seeds are disjoint, but the injected scenarios are not clinical ground truth. Report the limitations in the results file; do not hide high false-alarm conditions.

## Troubleshooting during the presentation

If a dashboard does not update, use its **Refresh dashboard** control. Check service state/logs:

```powershell
docker compose ps
docker compose logs --tail 80 backend worker edge-gateway ai-service
```

If an alert is not visible to another role, check whether it is linked to that role's shipment/organization. If QR says evidence pending, wait for anchoring and check again. If an operation is blocked, show the guard and explain it; do not directly edit MongoDB or manually mark an event complete.

Do not restart the Hardhat node during the demo. When finished, stop containers without deleting volumes:

```powershell
docker compose down
```

Even `docker compose down` stops the in-memory Hardhat chain, so the next run will not retain old chain evidence. Do not use `docker compose down -v` unless you intentionally want to delete persistent demo data too.

## Viva limitations to disclose

- Sensor readings, route/GPS, orders, inventory and demand records are synthetic; no physical IoT was used.
- The approved policy is a project demo rule, not a medical recommendation. AI is advisory; policy rules are authoritative.
- The chain is a local in-memory Hardhat chain. Restarting it loses its history; no public-chain verification is claimed.
- Ethereal is a disposable test-mail capture, not real email delivery.
- The forecast fixture is deliberately repeating and does not establish real demand accuracy. Supply recommendations require human approval; the fresh seeded batches are unreleased and yield zero eligible allocation.
- Browser camera QR support, Safari visuals, production security, clinical use and hosted CI were not verified in the Phase 11 freeze.
- See the detector report for all measured high-false-alarm conditions. Do not present these synthetic evaluation metrics as field performance.

## Official project references

- [README and quick start](../README.md)
- [Current implementation state](CURRENT_STATE.md)
- [Phase 11 freeze and executed verification](PHASE11_FREEZE.md)
- [Simulator controls and scenarios](IOT_SIMULATOR.md)
- [Policy alerts and review workflow](TEMPERATURE_ALERTS.md)
- [Manufacturer batch creation](MANUFACTURER_BATCH_CREATION.md)
- [Distributor and Healthcare workflow](OPERATIONAL_DASHBOARD_GUIDE.md)
- [QR verification details](TRACEABILITY_AND_DEMO_FEATURES.md)
