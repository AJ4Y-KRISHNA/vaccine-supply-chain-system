# Phase 6: Manual-override end-to-end demonstration

## Scope

This local demonstration verifies that a manual sensor override is only an input to the existing telemetry and cold-chain policy pipeline. It does not create alerts or release holds directly. All readings and identities used here must be synthetic. Do not use real vaccine records, real patient details, external messaging, or treat test limits as medical guidance.

The automated API integration test is `backend/tests/manualOverrideE2E.test.js`. It runs against an isolated random MongoDB test database and exercises the real simulator, telemetry persistence, policy evaluation, in-app notifications, role-scoped alert routes, live-shipment data route, response workflow, and review/clear path. Only the unrelated blockchain service is stubbed so that the test makes no chain writes. The frontend companion checks are in `frontend/src/__tests__/LiveShipmentVisualizer.test.js` and `frontend/src/__tests__/ProjectEnhancements.test.js`.

## Local demo preparation

1. Start MongoDB, the backend, and the frontend using the repository's normal local setup. Use one backend process only.
2. For a local synthetic demo only, set `SIMULATOR_MANUAL_OVERRIDES_ENABLED=true` in `backend/.env` and `REACT_APP_SIMULATOR_MANUAL_OVERRIDES_ENABLED=true` in the frontend environment. Restart the backend and rebuild/restart the frontend after changing its build-time flag. Both features are disabled by default.
3. Sign in as an admin. Select a dedicated synthetic batch and shipment. Confirm that the shipment belongs to that batch and that a virtual device is linked to that exact shipment.
4. Confirm the batch has an approved policy that explicitly supplies the limits for the metric being demonstrated. A useful *test-only fixture* is 2–8°C, 40–80% relative humidity, a 2-minute sustained-excursion threshold, and a 90-second maximum reading gap. Those values come from the automated fixture and are not medical recommendations; use only a policy explicitly approved for the synthetic demo batch.
5. Ensure a separate authorized quality reviewer is available. `admin` or `manufacturer` can acknowledge and record an operational response; only a current account designated with `canReviewColdChain` can review and clear the quality hold.
6. Use a stopped device with a fixed seed, a known simulation start time, and a one-minute tick interval. Readings use the simulation clock, not your computer clock.

## Scenario A — sustained high temperature

1. In Admin, open **Manual Sensor Console** and choose the exact shipment/device. Verify its batch, policy limits, latest reading, and the visible simulated-data banner.
2. Apply a hold override above the synthetic batch's approved maximum temperature. Give it a reason and an expiry long enough for the ticks. Do not change the approved policy to force the alert.
3. Generate one reading per simulated minute. With the two-minute test-fixture threshold, readings at minutes 0, 1, and 2 demonstrate the sustained path. A shorter excursion should remain review-required rather than being presented as sustained quarantine.
4. Open the alert queue. Verify the reason cites the configured limit and measured duration, labels the source **Manual sensor override**, and records a critical quarantine for the affected shipment/batch.
5. Check notifications as Admin, the owning Manufacturer, and the assigned Distributor. The Hospital may also receive an informational in-app notification. Confirm another manufacturer's account cannot see the alert. Email is disabled by default; when explicitly enabled, Admin and owning Manufacturer mail is queued separately from the in-app notices. No SMS is sent.
6. Open **Live Shipment** or the compact dashboard visualizer. After its next refresh, confirm the truck is red and stationary while the persisted hold is present. Its lane position represents saved shipment workflow progress; its road and GPS label are simulated.
7. As the owning Manufacturer (or Admin), acknowledge the alert with a note and record an action such as **inspect**, also with a note. Do not try to bypass the hold by dispatching the shipment.
8. In the console, select **Return to automatic**. Generate a new reading. Confirm the stored reading source returns to `auto-simulated` and that the deterministic automatic reading sequence continues for the same seed and clock.
9. Verify that this in-range recovery closes the active excursion but does **not** clear quarantine. A resolve/clear attempt without current quality review must be rejected.
10. As the designated reviewer, record a review with a note against the fresh in-range evidence, then explicitly clear/resolve with a separate note. Confirm the alert response audit and Batch Story record the acknowledgement, action, review, and clearance. The visualizer may return to its normal state only after the saved hold is cleared.

## Scenario B — sustained low humidity

1. After Scenario A has been explicitly reviewed and cleared, use the same synthetic shipment or a second clean synthetic batch with an approved policy that has both humidity limits.
2. Apply a manual hold with humidity below that policy's approved minimum. Do not infer or reuse a humidity limit when the policy has none.
3. Generate enough one-minute ticks to meet the approved duration rule. Confirm the alert is `LOW_HUMIDITY`, names the approved minimum and measured duration, and reports `Manual sensor override` as its source.
4. Confirm the same assigned notification audiences, scoped alert visibility, and red stationary shipment visual while the hold is active.
5. Acknowledge and record an action with notes. Return the device to automatic mode, generate a fresh in-range reading, and verify the hold remains until an authorized reviewer records current-evidence review and explicit clearance with notes.

## Automated verification

From `backend/`, run the targeted API integration and determinism suites:

```powershell
npm test -- --runTestsByPath tests/manualOverrideE2E.test.js tests/simulatorOverrides.test.js
```

The end-to-end cases use the actual HTTP routes and test the sustained high-temperature and low-humidity flows. The existing override suite includes a regression proving that the same seed and simulation clock preserve automatic readings through and after manual override use, plus a scheduled-tick/override lock race test.

From `frontend/`, run the visualizer and guided-checklist tests:

```powershell
npm test -- --watchAll=false --runInBand --runTestsByPath src/__tests__/LiveShipmentVisualizer.test.js src/__tests__/ProjectEnhancements.test.js
```

The guided checklist verifies completion from saved data only when both a cleared manual high-temperature alert and a cleared manual low-humidity alert have response audit notes, released overrides, and a later in-policy `auto-simulated` reading.

## Limitations

- The truck, road, coordinates, sensors, and readings are simulated. The truck position follows persisted workflow status, not live route progress or real GPS.
- Manual overrides are local demo/testing tools; the default feature flags are off. They do not control hardware or send external notifications.
- Simulator jobs and batch locks are process-local. Run one backend process; locks do not coordinate multiple workers.
- Override duration, excursion duration, alert escalation, and recovery evidence use the simulation clock. A paused device does not advance those clocks until a later tick or explicit monitor check.
- Returning to automatic mode or seeing an in-range reading never clears a quarantine. A designated reviewer must review current evidence and explicitly clear it.
- Synthetic fixture thresholds and scenario presets are test inputs only, not approved vaccine storage policy or a clinical safety determination.
