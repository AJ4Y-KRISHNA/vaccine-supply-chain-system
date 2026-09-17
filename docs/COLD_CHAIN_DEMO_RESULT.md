# Completed cold-chain demonstration

Completed **17 September 2026, 05:42:40 UTC (11:12:40 IST)** against local MongoDB `vaccineDB`, through the actual Express app and authenticated API routes.

**Synthetic software demonstration only.** The specimen contains zero doses, the product is labeled `SYNTHETIC DEMO ONLY — NOT FOR CLINICAL USE`, and the policy reference explicitly states that it is not an approved vaccine product/storage policy. Review and clearance reasons state that they were automated under the user's instruction, not a clinical assessment or real vaccine release.

## Account configuration retained

| Existing account | Configuration |
| --- | --- |
| `admin@test.com` | `canReviewColdChain: true`; demo reviewer assignment audited |
| `manufacturer@test.com` | `manufacturer: DEMO Cold-Chain Manufacturer` |
| `distributor@test.com` | `distributor: DEMO Cold-Chain Distributor` |
| `hospital@test.com` | `hospital: DEMO Cold-Chain Hospital` |

Organization mappings apply to the demo organizations only. No real organization ownership was inferred. Existing account passwords and roles were not changed. Each new mapping has an authorization record in `ColdChainAudit`.

## Retained identifiers

- Batch: `DEMO-CC-20260917-03B0E1`
- Shipment: `DEMO-SHIP-20260917-03B0E1`
- Device: `DEMO-IOT-20260917-03B0E1`
- Alert: `TEMP-6AAB7DCFBBC23E68AC2225DF`
- Policy revision: `6aab7dcfbbc23e68ac2225cb`
- Final alert phase: **CLEARED**, with no remaining batch/shipment cold-chain holds.

The batch remains `Demo only — no clinical inventory`; the shipment remains `Demo only — simulated in transit`. Clearance removed the cold-chain overlay without inventing a real release approval.

## Deterministic telemetry and state transitions

Seed: `cold-chain-reviewed-demo-v1`; clock starts `2026-01-01T00:00:00.000Z`; interval: 60,000ms. The synthetic fixture uses 2–8°C, 40–80% humidity, a 120,000ms excursion duration, a 90,000ms maximum reading gap, 10% critical battery, and 100°C/min plausibility limit. **These fixture values are not medical guidance.**

| Simulation time (UTC) | Temperature | Humidity | Battery | Evaluation | Hold after reading |
| --- | ---: | ---: | ---: | --- | --- |
| 00:00 | 10.51°C | 67.03% | 100% | Warning / review required | No |
| 00:01 | 10.66°C | 63.00% | 99.84% | Warning | No |
| 00:02 | 10.51°C | 58.44% | 99.59% | Critical / quarantine | Yes |
| 00:03 | 7.85°C | 74.24% | 99.46% | Normal reading | **Still yes** |

Critical explanation: “Critical: 10.51°C is 2.51°C above the approved maximum of 8°C for 2 consecutive measured minutes.” Here “approved” refers only to approval of the explicitly synthetic application fixture, not a medical product policy.

After the fourth reading, the demo submitted a recorded review, followed by an explicit clearance action as `admin@test.com`. The simulator was then stopped; the temporary HTTP server was closed. Database history remains, but the in-memory simulator instance does not remain running.

## Checks that passed

1. First excursion notified only admin and owning manufacturer.
2. Sustained excursion quarantined the batch and shipment.
3. Existing dispatch and administration endpoints both rejected actions with **409 `COLD_CHAIN_HOLD`**.
4. Admin, manufacturer, assigned distributor and destination hospital could see their alert and application notifications.
5. The manufacturer without reviewer capability could not clear: **403**.
6. Normal telemetry did **not** automatically release quarantine.
7. Even the reviewer could not clear before a review was recorded: **409**.
8. After recorded review and explicit clearance, both hold arrays were empty and the alert was **CLEARED**.
9. Four raw telemetry records, ten role-targeted notifications, and nine demo-batch audit records were retained. No vaccination record was created.
10. All **10 pre-existing batches and 13 pre-existing shipments** were compared before/after and remained unchanged. No database records were deleted. **Zero blockchain or forecasting calls** were attempted.

Audit sequence: `SYNTHETIC_DEMO_CREATED` → `POLICY_APPROVED` → `EVENT_OPENED` → `QUARANTINE_AUTHORIZED` → `QUARANTINE` → `EXCURSION_CLOSED` → `QUALITY_REVIEW` → `CLEAR_AUTHORIZED` → `CLEARED`. Reviewer and organization setup records are stored separately under `__access_control__`.

## Inspect or repeat

Start the project normally, log in with the existing accounts, and open **Temperature Alert Monitoring**. Filter by `DEMO-CC-20260917-03B0E1`; use All statuses or Resolved to see the completed event. Expand it to inspect its policy reference, explanations and audit history. No passwords have been reset.

For another synthetic run, from `backend`:

```powershell
node scripts/runColdChainDemo.js --execute
```

This creates a new uniquely named zero-dose demo batch/shipment and retains its history. It refuses remote MongoDB, missing accounts, non-reviewer admin, or conflicting existing organization mappings. It does not delete or reseed data. It uses the repository's existing seed-account credential by default; if those accounts have a different shared demo password, supply `DEMO_ACCOUNT_PASSWORD` through the environment, never a committed file or report. Differing per-account passwords require adapting login inputs before rerunning.

The demonstration used fresh in-memory JWT secrets and a temporary loopback-only HTTP listener. Persistent `.env` secrets were not changed. The current local project still needs its non-default persistent authentication secrets and temperature-ingestion API key configured before broader use; the seed accounts are for local development only.

An actual vaccine batch policy still requires the appropriate approved product/storage source and a qualified reviewer selected by the project owner. No such source was supplied or invented during this demonstration.
