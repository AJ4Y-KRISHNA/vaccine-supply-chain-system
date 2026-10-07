# Shipment GPS history and live shipment view

## Scope

This is a software-only, read-only visualization of role-visible shipment workflow, sensor readings and stored simulated GPS coordinates. It does not represent a physical truck or a live GPS feed. Route lines connect consecutive saved coordinates with straight segments; they are not road-routed or map-matched, and do not prove the vehicle visited the shipment destination.

## Data sources and authorization

- `GET /api/live-shipments` requires authentication and applies identity-scope filters to shipments, batches and telemetry. It returns at most 100 visible shipments and can filter on an exact `shipmentId`.
- Latest telemetry is joined only on an exact shipment ID. Batch-only telemetry is not attributed to a specific shipment.
- `GET /api/location-history/:batchId?limit=500` requires authentication and batch-read authorization. The backend returns chronological `LocationHistory` entries scoped to a batch.
- The frontend links GPS points to a shipment only when the saved `shipmentId` matches. A legacy point without a shipment ID is shown only when the returned shipment list has a single shipment for that batch; ambiguous points are omitted.
- Alert explanations continue to come from the existing role-targeted `GET /api/alerts` feed.

## Map behavior

The shipment card displays the stored GPS history as a Leaflet polyline on OpenStreetMap tiles. The first point is marked as the start and the most recent stored point is marked as latest; sampled intermediate points can be opened to inspect their timestamp and vehicle ID. The latest exact-shipment reading is used as a current-location fallback when no history point exists or when it is newer than the saved history. The destination is shown as text only because the active shipment record does not provide a geocoded destination coordinate.

If no valid GPS coordinate exists, the card explains that no map position is available and points the operator to the software sensor simulator. If the history API is unavailable, the card shows that error and may still display the latest location returned by the shipment feed. OpenStreetMap tiles require browser network access and are subject to OpenStreetMap tile-service availability and usage policy; the saved coordinates and routes remain application data.

## Placement and interaction

- Admin and Distributor dashboards show up to three visible shipment cards; Manufacturer now has the same role-scoped shipment GPS section.
- The dedicated `/live-shipments` page is available to Admin, Manufacturer, Distributor and Healthcare Professional accounts. A `shipmentId` query parameter opens a single visible shipment.
- The dashboard refreshes shipment and alert data every eight seconds while the browser tab is visible. Location history is fetched for batches represented in the currently visible cards.
- Sensor values, policy range, battery, alert details and status remain shown separately from the map. Status colors are informational, not a vaccine-safety determination.

## Verification

`backend/tests/locationHistoryRoutes.test.js` and the telemetry/location idempotency tests cover authorized chronological GPS history. `frontend/src/__tests__/LiveShipmentApi.test.js` checks the history API request. `frontend/src/__tests__/ShipmentLocationMap.test.js` covers coordinate validation, and `frontend/src/__tests__/LiveShipmentVisualizer.test.js` covers shipment-to-history filtering, map state, role-visible card loading, alerts and detail links.
