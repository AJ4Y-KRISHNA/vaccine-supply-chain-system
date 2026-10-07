# Phase 1 — Reliable local platform

This setup runs the vaccine supply-chain project as a **synthetic software simulation**. It is not a clinical, medical, or production system. Seeded users, policies, inventory, sensor readings, and demand history are test fixtures only.

## Start the local stack

1. Copy the root `.env.example` to `.env` and replace every `replace-with-...` value with a different local secret. Use a demo password of at least 12 characters. Do not commit `.env` or paste its values into screenshots. If changing `MONGO_HOST_PORT`, keep the value in this file; the host-run seed script uses it to reach Compose MongoDB.
2. From the repository root, build and start the stack:

   ```powershell
   docker compose up --build -d
   docker compose ps
   ```

3. Seed the synthetic accounts and demo records from the repository root:

   ```powershell
   npm run seed
   ```

   The equivalent command from `backend/` is `npm run seed`; that compatibility path uses `backend/.env`. The root command uses root `.env` and otherwise targets the Compose host port and `vaccine_supply_chain` database. The seed is repeatable for its fixed demo identities and IDs; it does not delete unrelated records. Historical orders are generated for the current month and the preceding 35 months with a deterministic seasonal curve and March/September campaign spikes.

   If `npm` is not installed on the host, run the same script inside the already-running backend container with `docker compose exec backend node scripts/seed.js`.

4. Open the role dashboards:
   - Main role dashboards: `http://localhost:3000`
   - Standalone field-operator panel: `http://localhost:5173`
   - API: `http://localhost:5000`

The seeded login route can be verified without touching application records by running `npm run acceptance:seed -- --execute`. It creates a random disposable local MongoDB database, runs the same seed script, signs in through the role login routes, then drops only that generated database.

All demo accounts use the single `DEMO_SEED_PASSWORD` value from the local `.env`:

| Role | Login email |
| --- | --- |
| Admin | `admin@demo.synthetic.test` |
| Manufacturer | `manufacturer@demo.synthetic.test` |
| Distributor | `distributor@demo.synthetic.test` |
| Field Operator | `fieldoperator@demo.synthetic.test` |
| Healthcare | `healthcare@demo.synthetic.test` |

The synthetic seed creates three batches, an append-only approved 2–8 °C demo policy for each, three healthcare stock snapshots, and 108 monthly synthetic order records. It does not create patient data or claim that the seeded policy is approved for any real product.

## Services and local boundaries

`docker-compose.yml` starts MongoDB, password-authenticated Mosquitto, password-protected Redis, a Hardhat node and local contract, FastAPI, Express backend, a separate Edge Gateway, the React dashboards, and the Vite field-operator panel. Docker health dependencies delay the backend until MongoDB, MQTT, Redis, the local chain/contract, and AI service are healthy. Browser-facing host ports bind only to `127.0.0.1`; Edge Gateway is private to the Compose network. The root `.env` provides local credentials and ports.

The container app accepts exact Compose hostnames from `DOCKER_INTERNAL_HOSTS`; this is an allowlist for local container-to-container HTTP/RPC/MQTT, not a general remote-host bypass. The Edge Gateway binds to `0.0.0.0` only inside Compose and is not published to the host. The existing loopback-only local Hardhat chain remains chain ID 31337.

Redis is started and actively probed by the readiness panel in this phase. **Redis Streams and independent stream consumers are not added by this phase**; existing telemetry persistence, authoritative policy evaluation, AI advisory, and chain anchoring retain their current backend execution paths.

## Telemetry input bounds

Both the backend ingestion endpoint and Edge Gateway use the shared validator. Temperature is limited to −40 through 60 °C; humidity and battery to 0–100; latitude to −90 through 90; longitude to −180 through 180. A supplied ISO timestamp must be no earlier than 24 hours before server receipt and no later than five minutes after it. Legacy payloads without a timestamp receive the server receipt time. Idempotency for sequenced telemetry uses `(deviceId, sequenceNumber)`; old clients that only send `sensorId` continue through a compatibility fallback. Configure simulated device start times near the current clock so the readings meet the ingestion window.

## Email capture and system health

Compose enables Nodemailer's Ethereal capture mailbox. Demo emails are sent to the temporary capture transport rather than real recipients. A captured preview URL is saved on the in-app notification (`emailPreviewLinks`) and the related email-delivery record. The readiness endpoint verifies SMTP availability but never returns mailbox credentials. Ethereal requires outbound internet access; without it, email remains unhealthy/queued and the panel correctly reports that instead of showing green.

The Admin dashboard's **Local-system readiness** panel reports backend, MongoDB, MQTT, Redis, AI, local chain/chain ID/contract bytecode, and demo email. MongoDB is checked with a temporary write/read/delete; the chain probe checks chain ID, code at the local contract address, and local block progression. The Redis check performs authenticated PING/PONG. The panel shows status only, not secret values.

## Tests

Backend tests cover telemetry bounds/windowing, sequenced idempotency, readiness checks, demo-email readiness, notification preview persistence, and synthetic seed-history generation. Frontend tests cover the expanded Admin readiness cards. Run backend tests with `cd backend; npm test`; the main frontend uses `cd frontend; npm test -- --watchAll=false`. The standalone panel is built/tested with `cd field-operator-panel; pnpm test` and `pnpm build`. The isolated seed/login proof is `npm run acceptance:seed -- --execute`.

The Docker images intentionally use only the FastAPI/Uvicorn dependencies required by the currently wired API routes. Optional experimental TensorFlow, PyTorch, Transformers, and Web3 packages remain in `ai-services/requirements.txt` for research workflows and are not installed in the lean API image.

## Verification status

On 2026-10-05, backend/frontend/field-panel/AI/Hardhat tests and the two front-end production builds passed. The isolated seed/login acceptance and 52-request end-to-end acceptance passed, including Ethereal message capture and notification preview-link persistence. Compose configuration syntax also parsed. The full container stack itself was not launched because Docker Engine (`com.docker.service`) was stopped; therefore container healthchecks, post-Compose `npm run seed`, and a green live Admin readiness panel still need confirmation after Docker Desktop shows its Engine running.
