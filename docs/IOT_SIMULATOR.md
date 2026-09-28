# Software IoT Simulator

## Scope

Milestone 1 adds a **software-only** virtual IoT device simulator. It does not require, connect to, or claim to represent physical hardware. The generator does not call blockchain or forecasting services. The subsequent policy-driven alert/quality-review extension is documented in [TEMPERATURE_ALERTS.md](TEMPERATURE_ALERTS.md).

Simulator readings are raw telemetry. The shared persistence service evaluates them against an explicitly approved batch policy. The generator's example 2–8°C range and 45–75% humidity distribution are simulation settings, not medical defaults or approved limits.

## Architecture and data model

`backend/services/iotSimulator.js` contains a seeded pseudo-random generator, a deterministic simulation clock, `VirtualDeviceSimulator`, and the in-memory `SimulatorManager` that owns active interval jobs.

Each tick is transformed by `backend/services/telemetryService.js` and saved to the existing MongoDB `TemperatureLog` collection. This is safer than a separate telemetry collection because dashboard and temperature-log code already read that collection.

Existing fields remain unchanged: `shipmentId`, `batchId`, `sensorId`, `temperature`, `recordedAt`, `status`, and `location`. The following fields are optional additions:

| Field | Meaning |
| --- | --- |
| `deviceId` | Virtual device identifier. `sensorId` is also set to this value for compatibility. |
| `sequenceNumber` | Reading sequence. Simulator persistence derives this from the existing `simulation.tick`; ingestion clients may submit it directly. |
| `vehicleId` | Virtual vehicle identifier. |
| `humidity` | Simulated relative humidity, as a percentage. |
| `batteryLevel` | Simulated battery percentage. |
| `location.lat`, `location.lng` | Simulated GPS location. |
| `simulation` | Source (`software-iot-simulator`), scenario, seed, and tick number. |

Simulator-produced `TemperatureLog` documents also have optional top-level `source`, `overrideId`, and `operatorUserId` provenance. `source` is `auto-simulated` or `manual-override`; the nested `simulation.source` remains `software-iot-simulator` for existing integrations. Legacy temperature-ingestion payloads are unchanged.

The existing `POST /api/temperature/ingest` request still accepts the original minimal payload; it now also accepts these telemetry fields as optional fields. Its API-key requirement and response format are unchanged.

When a reading has a device or sensor ID, batch ID, valid timestamp, and non-negative integer sequence number, persistence derives a stable key from those four values. MongoDB enforces uniqueness with a sparse unique index on that key. A retry with the same identity returns the existing `TemperatureLog` instead of appending another; changing the sequence number represents a distinct reading. Simulator ticks use their existing tick number, without changing the simulator seed or clock behavior. Legacy ingestion payloads without a complete identity remain accepted and do not receive this deduplication guarantee.

## Deterministic behavior

Pass the same `seed`, `startTime`, tick interval, route, temperature range, and scenario to receive the same sequence of readings. The simulation clock starts at `startTime`; the first tick is timestamped with that value, and each later tick advances exactly `tickIntervalMs`. The default clock start is `2026-01-01T00:00:00.000Z`, rather than the host clock, so default simulations are repeatable too.

`reset` stops the scheduler, restores the configured clock start and battery level, reinitializes the seeded generator, and removes the last runtime reading. It never deletes persisted logs, alerts, telemetry checkpoints, or quarantine holds. Replaying the same tick identity returns its existing log; a different sequence at an old timestamp can be stored but is skipped by alert evaluation as stale. Use a separate demo batch/device for independent replays. `durableSimulator.js` saves configuration, exact RNG/clock/battery state and pending readings in `SimulatorDevice`. After restart devices are restored **stopped** and require explicit start, not recreation. Current operator access is checked before each scheduled write.

Overlapping ticks/resets are rejected while persistence is in flight. Scheduled ticks skip a busy device. A persistence error stops its timer, exposes `lastError` and `pendingRetry` in status, and retains the exact reading for an explicit retry. Sequenced simulator/sensor readings are idempotent at the `TemperatureLog` record layer, including retries after a partial write; legacy payloads without a complete identity can still append duplicates. Alert state and notifications are independently deduplicated. `stop` prevents future timer ticks but does not cancel a write already in flight.

## Scenarios

| Scenario | Behavior |
| --- | --- |
| `NORMAL` | Temperature stays within `temperatureRange`; GPS follows the route; humidity varies from 45–75%; battery declines gradually. |
| `HIGH_TEMPERATURE` | Temperature is generated above `temperatureRange.max`. |
| `LOW_TEMPERATURE` | Temperature is generated below `temperatureRange.min`. |
| `GPS_MOVEMENT` | GPS moves along the configured route while remaining otherwise normal. |
| `BATTERY_DRAIN` | Battery drops substantially faster while the remaining values stay normal. |

Routes must contain at least two `{ latitude, longitude }` points. Locations are interpolated in deterministic steps, reach the final waypoint, then reverse along the same route without teleporting.

## API controls

All `/api/simulator/*` endpoints require a signed JWT and a current database account with `admin` or `manufacturer` role. Manufacturers are scoped to their own batches/devices; admins may also generate unassociated raw demo readings. `AUTH_OPTIONAL` does not bypass simulator or cold-chain safety authorization. Send `Authorization: Bearer <token>`.

| Method and path | Purpose |
| --- | --- |
| `POST /api/simulator/devices` | Create a virtual device. Duplicate device IDs return 409 instead of overwriting state. |
| `POST /api/simulator/:deviceId/start` | Start interval-based ticks and persistence. It does not emit an immediate tick. |
| `POST /api/simulator/:deviceId/stop` | Stop interval-based ticks. |
| `POST /api/simulator/:deviceId/tick` | Generate and persist one deterministic reading immediately. Works whether stopped or running. |
| `POST /api/simulator/:deviceId/reset` | Stop, then reset the deterministic clock, seed state, battery, and last reading. |
| `POST /api/simulator/:deviceId/scenario` | Stop and switch `{ "scenario": "NORMAL" }` (or another supported scenario), preserving device identity, RNG position, battery and clock. Use this to demonstrate recovery after a high/low scenario. |
| `GET /api/simulator/:deviceId/status` | Inspect one device's configuration and runtime state. |
| `GET /api/simulator/status` | Inspect all virtual device states in this backend process. |
| `GET /api/simulator/inputs` | Scoped batch/shipment options and supported scenarios. |
| `POST /api/simulator/:deviceId/monitor` | Arm/pause `{ "enabled": true }` silence monitoring; optional explicit `asOf` clock anchor. |

## Manual sensor overrides (backend phase)

Manual overrides are a separate, synthetic-only control path. The default is **disabled**: set `SIMULATOR_MANUAL_OVERRIDES_ENABLED=true` in the backend environment only for a local demo. The maximum lifetime defaults to 24 hours and may be lowered with `SIMULATOR_OVERRIDE_MAX_TTL_MS`; the default lifetime is 30 minutes and may be changed with `SIMULATOR_OVERRIDE_DEFAULT_TTL_MS`. The maximum is hard-capped at 24 hours. Time-to-live and hold/ramp durations use the virtual shipment clock, not wall-clock time; an override expires when a subsequent simulator tick reaches its configured expiry or behavior end.

Every manual override endpoint requires a current signed **admin** identity. Manufacturer and other roles are rejected in this phase. Each shipment can have only one active override; it must already have a virtual device linked to that shipment. New data is bounded to -40..60°C and 0..100% humidity. A custom override needs at least one target and a reason. Hold applies the target with deterministic bounded noise; ramp moves linearly from each device's current value to its target, then holds. A seeded hash of the simulator seed, override ID, measurement name, and simulation timestamp supplies noise without consuming or changing the existing automatic PRNG sequence. Thus, an automatic device with the same seed and clock keeps the same generated values, including after a manual period.

Available presets come from `backend/services/simulatorOverrides.js`: Refrigeration failure, Door left open, Freezing risk, Low humidity, and Sensor fault. Presets are synthetic examples, not approved vaccine storage policies. Sensor fault suppresses the measured sample and invokes the existing missing-telemetry policy check; it does not create an alert directly. Temperature/humidity values still pass through `persistSimulationReading` and the existing policy evaluator, which remains the only component that creates cold-chain alerts or holds.

| Method and path | Purpose |
| --- | --- |
| `GET /api/simulator/presets` | Read the data-driven scenario presets and configured expiry limits. |
| `GET /api/simulator/overrides?shipmentId=...&status=ACTIVE` | List active and historical override records (`status` can be `ACTIVE`, `RELEASED`, `EXPIRED`, or `ALL`). |
| `POST /api/simulator/overrides` | Start a manual override for an existing shipment/device. Provide either `presetId` or `targetTemperature` and/or `targetHumidity`, plus a reason for custom inputs. Optional controls: `behavior`, `rampDuration`, `holdDuration`, and `expiresInMs`. Durations are in simulated minutes; expiry is in milliseconds. |
| `PATCH /api/simulator/overrides/:id` | Change an active override. A new reason is required. Omitted target values remain unchanged unless a preset is selected. |
| `DELETE /api/simulator/overrides/:id` | Return to automatic mode immediately. Optional body: `{ "reason": "..." }`. Repeated release is idempotent. |

Create, change, release, and expiry produce immutable `SimulatorOverrideAudit` records with the admin/system actor, shipment and batch, values, reason, and a simulation-clock `eventTime`. The normal record's wall-clock `recordedAt` is retained for audit operations. Simulator ticks and override actions use the same existing in-process per-batch lock through telemetry persistence and policy evaluation; a tick already in flight completes as one ordered operation before a concurrent override takes effect. This matches the existing single-process lock limitation and is not a distributed lock.

This phase adds backend APIs only. The web control console is a later phase and must also be hidden unless `SIMULATOR_MANUAL_OVERRIDES_ENABLED=true`.

Example create request:

```json
{
  "deviceId": "IOT-001",
  "vehicleId": "TRUCK-01",
  "batchId": "VAC-001",
  "shipmentId": "SHIP-001",
  "scenario": "NORMAL",
  "seed": "demo-seed",
  "startTime": "2026-09-17T10:30:00.000Z",
  "tickIntervalMs": 5000,
  "temperatureRange": { "min": 2, "max": 8 },
  "route": [
    { "latitude": 9.9312, "longitude": 76.2673 },
    { "latitude": 9.9412, "longitude": 76.2773 }
  ]
}
```

Configured batch IDs must exist; a configured shipment must belong to that batch. Supply actual `Batch.batchId` and `Shipment.shipmentId` strings. A missing approved policy is reported as `POLICY_NOT_APPROVED` in `TemperatureLog.evaluation`; raw telemetry remains available without claiming safety.

## Running and testing

Start the backend as usual:

```powershell
cd backend
npm start
```

Admin and Manufacturer dashboards include device creation, scenario selection, start/stop/tick/reset, persistence errors and monitor controls. Status refreshes every five seconds. The frontend API client helpers are in `frontend/src/services/simulator.js`. A manual tick creates one `TemperatureLog` record when MongoDB is available.

Run the backend tests with:

```powershell
cd backend
npm test
```

Tests cover deterministic seeded readings, exact snapshot restoration, pending retry, all scenarios, lifecycle controls, authorization, telemetry mapping, legacy ingestion, monitoring, manual override bounds/roles/source/audit/expiry, the existing policy engine integration, automatic-sequence regression, and tick-versus-override lock ordering. Database suites create isolated random local test databases, never reseed the application database.

## Current limitations

- Schedules are single-process and deliberately restore stopped; configuration and pending readings are durable. Do not run multiple backend workers against these devices.
- Manual override state and audit history are database-backed, but lock serialization is process-local. Use one backend process only; this is demo tooling, not a physical sensor-control interface. A paused virtual clock also pauses expiry until a later tick.
- The subsequent extension evaluates readings and creates application notifications, but adds no blockchain writes, hardware integrations or forecast changes.
- Missing telemetry uses event/simulation time. For complete silence, use `/api/alerts/telemetry/check` or explicitly arm a device monitor. Armed monitors advance a separate anchored simulation clock using elapsed wall time and check every five seconds, including after restart. They detect a missing first expected reading without inventing a measured sample. Stop/reset does not pause monitoring or clear holds. Pause monitoring intentionally; recovery requires a fresh reading on the advanced clock. Historical seeds are never automatically interpreted as current wall time.
