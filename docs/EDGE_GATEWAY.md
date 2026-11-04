# Edge Gateway (synthetic software simulation)

The Edge Gateway is a separate Node process that provides a network boundary between simulated devices and the existing Express/MongoDB ingestion path. It is a software-only component; it does not represent hardware, clinical monitoring, or a production cold-chain gateway.

## HTTP path

The gateway exposes `GET /health` and authenticated `POST /ingest`. It validates telemetry with the same Joi schema as the backend, calculates EWMA, rolling temperature z-score, rate of change and a local 2–8°C threshold result, and attaches these under `edge`. Policy alerts in the backend remain authoritative; `edge.localAlert` is a separate local signal. Correlation IDs are retained across forwarding. MQTT is the simulator default and uses QoS 1 plus an application acknowledgement; HTTP(S) is the fallback when MQTT is unavailable.

The gateway accepts HTTP upstreams only on loopback; a remote upstream must use HTTPS. URLs containing embedded credentials are rejected. API keys are supplied through local environment variables and must not be committed.

## MQTT path

The gateway subscribes at QoS 1 to `<MQTT_TOPIC_PREFIX>/+/+`. The topic vehicle and batch segments must match the payload. Each changed sensor snapshot is stored in MongoDB before it is acknowledged; repeated identical snapshots are suppressed until a heartbeat is due. Queue sequence numbers increase monotonically per device, independently of simulator tick numbers. Pending rows flush one at a time in sequence order; a failed upstream send stops that device's flush so later rows cannot leapfrog it. The queue and edge calculation state survive gateway restarts. `LINK_LOSS` is a synthetic scenario that makes the gateway hold forwarding while still receiving telemetry; selecting another scenario resumes flushing. This is a software simulation, not an actual network-disconnection or hardware test.

Compose disables the legacy backend MQTT subscriber so the gateway is the only consumer. Direct backend ingestion remains available for compatibility.

## Local startup

1. Start MongoDB, Mosquitto, backend and gateway (`docker compose up --build -d`). The gateway requires `MONGO_URI` for its durable queue.
2. Copy `backend/edge-gateway/.env.example` to `backend/edge-gateway/.env` and fill in fresh local gateway and backend API keys. Do not reuse the placeholder values.
3. To use HTTP, set the backend simulator environment to `SIMULATOR_TRANSPORT=http`, `SIMULATOR_INGEST_URL=http://127.0.0.1:5100/ingest`, and `SIMULATOR_INGEST_API_KEY` to the gateway key. Start the gateway from `backend` with `npm run start:edge-gateway`.
4. To select a deterministic profile, configure `SIMULATOR_SCENARIO` (`NORMAL`, `DOOR_OPEN`, `COMPRESSOR_DRIFT`, `SENSOR_FLATLINE`, `GPS_JUMP`, or `LINK_LOSS`) and `SIMULATOR_SEED`, or select the profile through the existing simulator API. Legacy `HIGH_TEMPERATURE`, `LOW_TEMPERATURE`, `GPS_MOVEMENT`, and `BATTERY_DRAIN` profiles remain compatible. The default synthetic route contains Kochi, Tripunithura, Muvattupuzha, Perumbavoor and a Healthcare Center waypoint.

The HTTP listener is restricted to loopback outside Compose because inbound TLS termination is not implemented. HTTP requires the gateway API key plus an HMAC-SHA256 signature tied to the device ID and telemetry fields; MQTT also authenticates to Mosquitto using broker credentials and verifies the same device signature. Keep `EDGE_GATEWAY_DEVICE_SECRET` private and shared only by the local simulator and gateway. This demo uses one fleet signing secret, not unique provisioned hardware credentials. `GET /health` reports process status and pending queue count, not clinical or full-platform readiness. Local thresholds can be changed using `EDGE_MIN_TEMPERATURE` and `EDGE_MAX_TEMPERATURE`.

## Tests and compatibility

`backend/tests/edgeMath.test.js` covers edge statistics and local threshold reasons. `backend/tests/edgeGatewayLinkLoss.test.js` exercises buffering, ordered flush and duplicate retry handling using an in-memory test store; it does not substitute for a live Docker outage test. `backend/scripts/runSystemAcceptance.js --execute` asserts that edge alert flags survive Mongo persistence. `EdgeGatewayQueue` and `EdgeGatewayState` are Mongo-backed. MQTT QoS 1 plus queue idempotency is at-least-once transport with deduplication, not a formal exactly-once guarantee. Redis Streams and independent consumer groups remain future work.
