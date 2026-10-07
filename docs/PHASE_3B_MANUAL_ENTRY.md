# Phase 3B — Manual data entry

This phase adds manual and CSV telemetry as alternative sources to the existing synthetic telemetry ingestion path. Readings are validated by the shared telemetry validator and published to the Redis telemetry stream when the event backbone is enabled; persistence, approved-policy alert evaluation, advisory inference and blockchain anchoring remain the existing consumers. Data is synthetic demonstration data only and is not for clinical or production use.

## Reading entry

- `POST /api/readings/manual`: authenticated Admin, Distributor or Field Operator. Requires batch, vehicle, temperature, humidity, battery, coordinates, timestamp and operator note. Actor identity comes from the access token.
- `POST /api/readings/import`: authenticated Admin or Healthcare, CSV (`text/csv` or multipart `.csv`), at most 5,000 data rows. Valid rows are queued in timestamp order; the response reports each row.
- `POST /api/readings/:id/correct`: authenticated Admin, Distributor or Field Operator. Adds a new manual record with `supersedes`; the saved original is not updated.
- CSV headers: `batchId,vehicleId,temperature,humidity,battery,lat,lon,timestamp,note` (optional `shipmentId` and `deviceId`).

Manual readings reject future dates, invalid shared-schema values, unknown batches and blank notes. A change over 8 °C/minute is accepted with `needsReview=true`. Approved batch policy rules—not this plausibility flag or AI—remain authoritative for cold-chain alerts.

## Source migration

Run `node backend/scripts/migrateReadingSources.js` from the repository root after setting `MONGO_URI` to the local demo database. The migration maps legacy automatic simulator values to `simulator`, legacy operator overrides to `manual`, and fills absent source values on readings, location points, orders and inventory-event records. It does not replace existing non-empty provenance or change original readings.

`DATA_MODE=manual` prevents simulator HTTP operations, does not auto-resume saved simulator devices, and marks readiness as `manual mode`. `simulator` and `mixed` retain simulator endpoints. Defaults to mixed mode if unset.

## Verification status

Unit and route tests are in `backend/tests/manualReading.test.js`; the frontend form/report test is in `frontend/src/__tests__/ManualReadingEntry.test.js`. `node scripts/acceptance.js` includes a manual out-of-policy scenario after its normal simulator scenario. If the Compose environment is set to `DATA_MODE=manual`, it instead runs a manual-only end-to-end acceptance (no simulator API call) and verifies persistence, policy alert, in-app notification, local Merkle confirmation, proof endpoint, and shipment chart history. The acceptance runner requires the local Docker Compose services, Redis, and Hardhat. A `202 QUEUED` response means asynchronous consumers still need time to persist, alert, notify, and anchor the record.

For the manual-only run, set `DATA_MODE=manual` in the root `.env`, recreate the Compose services so the backend receives that value, seed synthetic records, then run `node scripts/acceptance.js`. Restore `DATA_MODE=mixed` (or `simulator`) and recreate the stack to re-enable simulator controls.
