# Phase 6 — Role dashboards and real-time updates

## Scope

This phase adds an authenticated, role-scoped WebSocket channel for the existing synthetic software demonstration. MongoDB and the REST APIs remain authoritative; WebSocket messages are best-effort UI updates, not a durable event log. The UI refreshes from REST when a socket event arrives and automatically returns to polling when the socket is unavailable. All records and route positions remain synthetic and are not for clinical or production use.

## Event flow

- `backend/services/roleDashboardWebSocket.js` attaches `/ws/dashboard` to the existing HTTP server. It requires an access token in the `vaccine-dashboard.v1` WebSocket subprotocol handshake, checks the browser origin, reloads the account, and scopes subscriptions to Admin, manufacturer-owned batches, distributor-assigned shipments, or healthcare-destination shipments.
- `backend/services/dashboardEventBus.js` publishes reading, position, alert lifecycle, notification, shipment workflow and Merkle anchoring updates. The `ws` publisher never changes a persistence or policy outcome; missed events are recovered by the dashboard REST refresh/fallback polling.
- The existing direct telemetry path and Redis Stream policy/AI consumers emit to that publisher after the corresponding record is saved. The anchoring worker publishes after it saves a confirmed/failed Merkle-window status.
- `frontend/src/hooks/useDashboardRealtime.js` shares one native WebSocket connection among dashboard components in the page. It reconnects with bounded backoff and exposes `Live` only after the server's `READY` message. Otherwise the UI shows `Degraded · polling fallback`.
- Shipment cards in Admin, Manufacturer, Distributor and Healthcare views fetch the organization-scoped shipment telemetry history and render temperature and humidity SVG charts. Configured policy bands are displayed; readings beyond a configured range are marked. No external charting dependency or sensor data source was added.
- Alert details include policy reason, separate advisory-only AI explanation, notification target roles, and per-reading Merkle evidence status (`yes`, `pending`, or `no`).

## Verification

From `backend`, run `node node_modules/jest/bin/jest.js --runInBand tests/roleDashboardWebSocket.test.js tests/liveShipmentHistory.test.js tests/temperatureAlertService.test.js tests/alertRoutes.test.js`.

From `frontend`, run `$env:CI='true'; node node_modules/react-scripts/scripts/test.js --watchAll=false --runInBand src/__tests__/DashboardRealtime.test.js src/__tests__/LiveShipmentVisualizer.test.js src/__tests__/TemperatureAlertPanel.test.js`, then `node node_modules/react-scripts/scripts/build.js`.

The role-socket integration test measures local delivery of a synthetic reading to Admin, Distributor and Healthcare sockets and asserts less than one second, while attaching both the existing Field Operator and role-dashboard gateways to the same HTTP server. A chart integration test pushes a reading and observes the latest-history chart update in under one second. The UI hook test proves that `READY` sets Live and socket closure sets Degraded; component tests exercise the policy-band chart and fallback status. After the source tests passed, the local backend and frontend Compose images were rebuilt and recreated; both reported healthy, and a read-only handshake against the running backend returned `READY role=admin`. This is a local demonstration check, not a broad browser/device performance benchmark.

## Boundaries and assumptions

- Notifications are pushed only to their recorded recipient role/organization; alert lifecycle events are scoped by the user's batch/shipment membership.
- Access-token refresh is handled by reconnecting with the current per-tab session token; the WebSocket does not extend token lifetime.
- The charts use saved HTTP history after push events, so they do not infer or synthesize missing samples. A blank chart means no visible history was returned.
- The existing browser-camera QR flow and unrelated operational workflows are unchanged.
