# Manual Simulator Control Console

## Purpose and scope

The console is an admin-only local demonstration tool for applying synthetic temperature and/or humidity readings to one existing shipment. It changes sensor input only. Each resulting sample is persisted by the existing simulator/telemetry pipeline, and the existing cold-chain policy engine alone evaluates the sample and creates alerts, notifications, and quality holds. The console does not directly create or resolve an alert or quarantine, and it does not control physical equipment. Synthetic readings are not clinical evidence or vaccine-safety determinations.

The feature is off by default. The backend must have `SIMULATOR_MANUAL_OVERRIDES_ENABLED=true`; the frontend must be rebuilt/restarted with `REACT_APP_SIMULATOR_MANUAL_OVERRIDES_ENABLED=true`. Set both only for a local synthetic demonstration. The frontend flag hides the navigation item and route in the app; backend routes independently require the feature flag and a current signed-in `admin` identity. A hidden link or direct URL is not an authorization control.

## Requirements

- MongoDB, the Express backend and React frontend are running using the project's existing local setup.
- The signed-in account has the `admin` role.
- A shipment has an attached approved `ColdChainPolicy`.
- At least one virtual simulator device is linked to that exact shipment.
- The backend and frontend override flags are both enabled, and the frontend has been restarted/rebuilt after changing its flag.

The page is available at `/admin/manual-simulator` only while the frontend feature flag is enabled. The Admin Dashboard shows the navigation link under the same condition.

## Demonstration steps

1. Sign in as an admin and open **Manual Sensor Console** from the Admin Dashboard.
2. Confirm the **SIMULATOR TOOL — SYNTHETIC DATA ONLY** banner. Choose a shipment from the picker. Verify that its batch, vaccine, approved temperature range, and any approved humidity range match the intended test fixture.
3. Confirm a linked virtual device is shown. If there is no device, return to Admin Dashboard → Cold Chain & IoT, create or select the virtual device, and associate it with this shipment. If the batch has no approved policy, configure and approve the demo policy first; do not infer limits from a simulator range.
4. For an in-range demonstration, keep the custom temperature target within the displayed policy limits, provide a short reason, and press **Apply override**. The page displays the active override and its expiry against the simulation clock.
5. Press **Generate one reading** or start the device in the existing simulator controls. The override applies on the next simulator tick. The live panel refreshes from saved readings and policy/alert records; identify the manual-source label and explain that evaluation is performed server-side by the policy engine.
6. To demonstrate a policy excursion, select a suitable synthetic preset or enter a value outside the approved policy band. Read the confirmation step before confirming. Generate the required subsequent simulator ticks; the batch policy's excursion duration and reading-gap rules determine whether the result is review-required or quarantined. A preset does not guarantee a critical alert independently of that policy.
7. Review the generated alert reason, source, severity, recommended action, and quarantine status. The console displays system outcomes; it never substitutes for the authorized alert-review workflow.
8. Press **Return to automatic** to release the active override. Generate another reading and confirm that the source returns to the automatic simulator. Releasing the override does not clear a cold-chain quality hold.
9. If a batch is quarantined, keep it held until the existing authorized quality-review process has valid recovery evidence and records a review/clear action. A normal reading or returning the device to automatic mode does not release it.

For a complete, repeatable high-temperature and low-humidity class demonstration—including recipient checks, acknowledgement, automatic recovery, reviewer clearance, and test commands—follow [MANUAL_OVERRIDE_END_TO_END.md](MANUAL_OVERRIDE_END_TO_END.md).

## Controls and feedback

- Selectors are limited to shipments returned by the authenticated simulator input endpoint. Batch and vaccine details are resolved from the selected shipment.
- Temperature inputs use physical bounds of -40°C to 60°C; humidity inputs use 0% to 100%. The policy-approved bands are separately marked and displayed. Out-of-policy values require a second confirmation.
- Presets are returned by `GET /api/simulator/presets`. They are synthetic demonstration definitions, not product policy.
- Hold/ramp duration and override expiry are measured in simulated minutes. The console shows the effective expiry and remaining simulation time. The simulator clock advances on ticks, so a stopped/paused simulator also pauses this countdown and expiry.
- **Generate one reading** calls the existing simulator tick endpoint. It does not bypass simulator locking, telemetry persistence, policy evaluation or alert handling.
- The live panel refreshes the device, selected shipment's alerts/overrides, and batch policy story every three seconds while the page is visible. The manual override remains active until released or until a simulator tick reaches its expiry/behavior end.

## Security and audit

The frontend hides the page when its build-time feature flag is absent/false and wraps the route with the existing admin role guard. The API independently requires a valid current signed admin identity and rejects operations while the backend flag is off. Other roles cannot use these manual-override endpoints. Input bounds, reasons, per-shipment single-active-override rules and existing simulator policy processing are validated server-side. Override create, change, release and expiry are stored in the append-only simulator override audit collection. Dashboard/UI checks are not relied on as the security boundary.

## Limitations

- This is synthetic software-only test tooling. It has no physical sensor, truck, GPS, medical, or cold-room control integration.
- Automatic mode remains the default; manual overrides affect only a specific linked shipment and take effect on its next simulator tick.
- Jobs and per-batch locks are single-process. Run one backend process for the demo; locks are not distributed across backend workers.
- A policy without humidity limits will not evaluate humidity excursions. The console displays that condition and does not invent a humidity range.
- Alert/quarantine duration, sensor gaps and expiry use the simulation clock. Use sufficient ticks at valid timestamps to demonstrate sustained conditions. A normal reading, pausing, release, or expiry does not clear a quality hold.
- The override console itself does not directly send external messages. Resulting policy alerts retain in-app notifications and may use the separately configured optional email outbox; SMS is not implemented.

## Verification

The frontend test suite includes coverage for feature-flag hiding, shipment/policy/live data, input and policy-range confirmation, create/update/release/tick controls, API request paths, and shipment-aware Batch Story deep links. Backend tests continue to cover the feature flag, admin-only API authorization, validation, persistence, source labeling, expiry and tick/override lock behavior.
