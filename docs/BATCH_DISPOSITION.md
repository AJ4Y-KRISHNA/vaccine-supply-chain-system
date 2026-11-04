# Batch Disposition Tracking

Batch disposition is a terminal operational record separate from the existing manufacturing, release, shipment, and cold-chain status fields. Existing batches without a stored disposition are treated as `active`.

## State machine

| Current state | Allowed next state | Notes |
| --- | --- | --- |
| `active` | `administered` | Only after all batch doses have confirmed hospital delivery and matching saved administration records. |
| `active` | `expired` | The stored batch expiry date must have passed. |
| `active` | `discarded` | Requires a reason code and an authorized actor with custody/ownership. |
| `active` | `recalled` | Requires a reason code; only an admin or the owning manufacturer may recall. |
| Any terminal state | None | Terminal state, reason and timestamp are immutable through this API. Repeating the same request is idempotent. |

`active` is the initial/default state, not a transition endpoint. The API does not allow a terminal batch to be reactivated or changed to another terminal state.

## Permissions

| Role | `administered` | `expired` | `discarded` | `recalled` |
| --- | --- | --- | --- | --- |
| Admin | Yes, with the same inventory evidence | Yes, if expiry date passed | Yes | Yes |
| Manufacturer | No | Own batch | Own batch | Own batch |
| Distributor | No | Batch in unconfirmed distributor custody | Batch in unconfirmed distributor custody | No |
| Healthcare | Batch delivered and confirmed to that hospital, with full-lot administration evidence | Batch delivered and confirmed to that hospital | Batch delivered and confirmed to that hospital | No |

Every terminal update requires an uppercase underscore `reasonCode`. Optional `reason` notes are limited to 500 characters. The API records the timestamp, authenticated user ID, and role; clients cannot provide or override those audit fields.

## API

`PATCH /api/batches/:batchId/disposition`

Example request:

```json
{
  "status": "recalled",
  "reasonCode": "MANUFACTURER_RECALL",
  "reason": "Synthetic demonstration record"
}
```

The request uses the project's existing bearer-token authentication and organization scoping. Responses include the saved `disposition` object and an `alreadySet` flag for safe retries. `400` indicates invalid input, `403` a role/ownership/custody failure, `404` an unavailable batch, and `409` an invalid state or unmet operational condition.

Once terminal, existing protected shipment, release, inventory and administration operations reject the batch. Inventory allocation also excludes it. Telemetry history remains readable and may continue to be collected for traceability; a disposition is not an instruction to disable a sensor.

The status appears in the existing admin monitoring batch feed. It is a workflow disposition record only, not a medical safety determination or substitute for applicable approved policy and quality review.
