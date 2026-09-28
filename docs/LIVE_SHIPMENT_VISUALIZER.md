# Live shipment visualizer

## Scope

This is a software-only, read-only visualization of persisted shipment workflow and sensor records. The SVG road and vehicle are illustrative. It does not represent a physical truck or a live mapping/GPS feed.

## Integration

- GET /api/live-shipments requires an authenticated user and applies identityScope.scopeData to shipment, batch, and telemetry queries.
- The endpoint returns a maximum of 100 role-visible shipments, supports limit and an optional exact shipmentId, and returns 404 when a requested shipment is not visible to the current organization.
- Policy values come only from the approved ColdChainPolicy referenced by the batch. Latest telemetry is joined only on an exact shipmentId; batch-only telemetry is not attributed to an individual shipment.
- Related alert detail comes from the existing GET /api/alerts endpoint, retaining its role-targeted alert visibility.

## Display rules

The truck fixed position maps the persisted workflow stage: pending 6%, verified 28%, in transit/dispatched 58%, supplied to the vaccination center 82%, and delivered/confirmed 100%. It does not move on a timer. A delivery/confirmation or quarantine/hold leaves the truck stationary.

Temperature and humidity gauge ranges are shown only when present in the batch approved policy. Green indicates the latest measurements are within configured ranges; amber indicates an out-of-range measurement, unresolved visible alert, or configured critical battery condition; red indicates quarantine/quality hold; gray means required policy or telemetry is unavailable. These are display states, not a vaccine-safety determination.

The saved coordinate, when present, is labeled simulated GPS. It is not used to imply a map-matched route. Every instance is labeled Simulated.

## Placement and interaction

- Dedicated route: /live-shipments, available to Admin, Manufacturer, Distributor, and Healthcare Professional accounts. A shipmentId query parameter opens one visible shipment directly.
- Admin and Distributor dashboards display three shipment lanes initially. The dedicated route displays five and expands in capped groups of five.
- The Admin manual simulator console displays the selected shipment. Selecting the vehicle or its details link opens the same detail route and related alert explanation.
- Refresh occurs every eight seconds while the page is visible. Polling is paused while the browser tab is hidden.
- Truck motion uses a transform transition. The operating-system reduced-motion preference disables the transition and alert pulse; the view remains readable without animation.

## Verification

backend/tests/liveShipmentRoutes.test.js covers authentication, latest exact-shipment reading selection, approved policy projection, and organization scoping. frontend/src/__tests__/LiveShipmentApi.test.js checks request parameters. frontend/src/__tests__/LiveShipmentVisualizer.test.js covers progress/state mapping, hold/delivery stopping, alert details, detail links, show-more behavior, and reduced motion.
