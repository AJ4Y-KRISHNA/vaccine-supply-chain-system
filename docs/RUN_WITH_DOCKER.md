# Run the full project with Docker Desktop (Windows PowerShell)

This guide starts the local Compose stack for the **synthetic software demo**. It does not use physical sensors, real vaccine records, a public blockchain, or production services. Do not use it for clinical decisions.

## Phase 4 update for an existing stack

Rebuild the three changed services and backfill only missing ownership on marked synthetic seed orders. These commands do not reseed passwords/stock or restart the chain/database. Use the same root `.env` and host-port settings that started your stack.

```powershell
docker compose build ai-service backend frontend
docker compose up -d --no-deps --wait --wait-timeout 180 ai-service backend frontend
docker compose exec -T backend node scripts/backfillSyntheticDemandOwners.js
docker compose ps
```

Open Admin **Forecast Analytics** or Manufacturer **Forecast analytics**. Generate a 3/6-month forecast, download thesis metrics JSON, and (Admin only) compute/review a forecast-based recommendation. The `analytics-artifacts` Docker volume retains server JSON exports. Fresh seed batches correctly show `BATCH_NOT_RELEASED` until the existing production/lab release process is completed. See [PHASE4_ANALYTICS.md](PHASE4_ANALYTICS.md).

**Phase 3:** Compose now enables Redis Streams and MongoDB `rs0` on the existing volume. Ingestion returns queued acceptance receipts; dashboards receive committed results asynchronously. No additional secret is required beyond the existing Redis settings. If running host-side Mongo tools, use the selected host port with `?directConnection=true` (for example `mongodb://127.0.0.1:27018/?directConnection=true`). The additional isolated verification command is `node backend/scripts/runEventBackboneAcceptance.js --execute`; it needs the built AI image and installed backend/blockchain dependencies. See [EVENT_BACKBONE.md](EVENT_BACKBONE.md) for retry/replay, retention and local-chain limitations.

Run each code block in PowerShell. Start in the repository root (`D:\proejcts\vaccine-supply-chain-system` in the example below). Do not share or commit `.env` values.

## 1. Open Docker Desktop and verify its engine

Open Docker Desktop and wait until it says the Engine is running. Then run:

```powershell
Set-Location "D:\proejcts\vaccine-supply-chain-system"
docker version
docker compose version
```

Both the Client and Server sections must appear in `docker version`. If it reports that it cannot connect to the Docker API, Compose cannot start containers yet: open/restart Docker Desktop, wait for the Engine, and repeat the check.

## 2. Prepare the root `.env`

Compose reads `.env` from the repository root, not `backend\.env`. Preserve an existing `.env`; do not overwrite it with `-Force`.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

In that root `.env`, set all eight values below. Use the random values you generated for the seven secrets; choose and remember a local demo login password of at least 12 characters for `DEMO_SEED_PASSWORD`. Keep `MQTT_USERNAME=synthetic-demo` or choose a local username. Replace every `replace-with-...` placeholder. Do not paste the values into chat or screenshots.

```text
JWT_SECRET=<random secret, at least 32 characters>
REFRESH_SECRET=<different random secret, at least 32 characters>
TEMP_API_KEY=<different random API key, at least 32 characters>
EDGE_GATEWAY_API_KEY=<different random gateway key, at least 32 characters>
MQTT_USERNAME=synthetic-demo
MQTT_PASSWORD=<different long random password>
REDIS_PASSWORD=<different long random password>
DEMO_SEED_PASSWORD=<your remembered demo password, at least 12 characters>
```

Save and close Notepad. The current machine has another process using port `27017`, so set the Compose-published Mongo port to `27018` in root `.env` (or choose a different free port):

```text
MONGO_HOST_PORT=27018
```

Keep the other host ports at their defaults unless they are already occupied. The services use their private Compose-network names internally, so changing the Mongo host port does not change the backend's Mongo connection.

## One copy/paste launch block

After saving real local values in the **repository-root** `.env`, paste this entire block into PowerShell from any directory. It checks the prerequisites, temporarily maps MongoDB to host port `27018`, builds/starts the stack, waits up to three minutes for the backend, seeds synthetic data, and opens both UIs. It does not print secret values.

```powershell
$ErrorActionPreference = "Stop"
$repo = "D:\proejcts\vaccine-supply-chain-system"
Set-Location $repo

if (-not (Test-Path .env)) { throw "Root .env is missing. Run: Copy-Item .env.example .env; notepad .env" }

# Check required root .env entries without displaying their contents.
$settings = @{}
foreach ($line in Get-Content .env) {
  if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*?)\s*$') {
    $settings[$matches[1]] = $matches[2]
  }
}
$required = @("JWT_SECRET", "REFRESH_SECRET", "TEMP_API_KEY", "EDGE_GATEWAY_API_KEY", "MQTT_USERNAME", "MQTT_PASSWORD", "REDIS_PASSWORD", "DEMO_SEED_PASSWORD")
$invalid = @($required | Where-Object {
  -not $settings.ContainsKey($_) -or
  [string]::IsNullOrWhiteSpace($settings[$_]) -or
  $settings[$_] -match '^replace-with-' -or
  $settings[$_] -match '^change-me'
})
if ($invalid.Count -gt 0) { throw "Set these root .env entries to real local values first: $($invalid -join ', ')" }
if ($settings["DEMO_SEED_PASSWORD"].Length -lt 12) { throw "DEMO_SEED_PASSWORD must be at least 12 characters." }

# This machine's port 27017 is occupied. This override lasts for this PowerShell window only.
$env:MONGO_HOST_PORT = "27018"

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not responding. Start Docker Desktop and wait for Engine running." }

docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw "Compose configuration failed. Fix the root .env/config error shown above." }

docker compose up --build -d
if ($LASTEXITCODE -ne 0) {
  docker compose logs --tail 100
  throw "A service image failed to build or start. See the build-blocker notes in this guide."
}

$backendReady = $false
for ($attempt = 1; $attempt -le 36; $attempt++) {
  docker compose exec -T backend node -e 'fetch("http://127.0.0.1:5000/").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' *> $null
  if ($LASTEXITCODE -eq 0) { $backendReady = $true; break }
  Start-Sleep -Seconds 5
}
if (-not $backendReady) {
  docker compose ps
  docker compose logs --tail 100 backend mongo mosquitto redis hardhat ai-service edge-gateway
  throw "Backend did not become healthy within three minutes. Check the service logs above."
}

docker compose exec -T backend node scripts/seed.js
if ($LASTEXITCODE -ne 0) { throw "Synthetic seed failed. Check DEMO_SEED_PASSWORD and backend logs." }

docker compose ps
Start-Process "http://localhost:3000"
Start-Process "http://localhost:5173"
Write-Host "Started. Main dashboards: http://localhost:3000 | Field panel: http://localhost:5173"
Write-Host "All seeded demo roles use the DEMO_SEED_PASSWORD from the root .env."
```

If this block stops at `docker compose up --build -d`, follow the image-build troubleshooting section below; the seed and browser-opening steps run only after the backend is reachable.

## 3. Check Compose configuration and start all services

```powershell
docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw "Compose config failed. Fix the reported .env/config issue before starting." }
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { throw "Compose start/build failed. See the troubleshooting section below." }
docker compose ps
```

Wait for services to show `healthy` (or `running` for services without a healthcheck):

```powershell
docker compose ps
```

It is normal for the Hardhat service to take a little longer because it deploys the local demo contract when it starts. If a service exits or stays unhealthy, inspect its logs:

```powershell
docker compose logs --tail 100
docker compose logs --tail 100 backend edge-gateway frontend field-operator-panel
```

## 4. Seed synthetic users and demo records

Wait until `backend` is healthy, then seed from inside the backend container. This route does not require Node.js or npm installed on Windows:

```powershell
docker compose exec backend node scripts/seed.js
```

The command should report five role accounts, three batches/policies, three inventory snapshots, and 108 synthetic monthly order records. The seed is repeatable for those demo records; it does not clear unrelated database records.

If you have Node.js and npm installed on Windows, the equivalent root command is:

```powershell
npm run seed
```

## 5. Open the applications and sign in

- Main role dashboards: <http://localhost:3000>
- Standalone field-operator panel: <http://localhost:5173>
- Backend root check: <http://localhost:5000>
- Admin local-system readiness API: <http://localhost:5000/api/admin/readiness>

Use these seeded email addresses and the same `DEMO_SEED_PASSWORD` you placed in root `.env`:

```text
Admin:        admin@demo.synthetic.test
Manufacturer: manufacturer@demo.synthetic.test
Distributor:  distributor@demo.synthetic.test
Healthcare:   healthcare@demo.synthetic.test
```

On the Admin dashboard, review **Local-system readiness**. It reports status for MongoDB, MQTT, Redis, AI, the local chain/contract, and demo email. The email status may be unhealthy if the machine cannot reach Ethereal's disposable SMTP service; the application does not send those captured messages to real recipients.

## 6. Confirm telemetry and service logs

The main dashboard provides the role workflows and simulator controls. The field-operator panel is a separate view; select an available shipment before expecting readings, route, alerts, and charts. It uses simulated shipment data, not live vehicle tracking.

For a quick service view:

```powershell
docker compose ps
docker compose logs --tail 50 backend edge-gateway mosquitto redis ai-service hardhat
```

All generated users, batches, sensor readings, inventory and demand fixtures are synthetic. The Hardhat chain is local (chain ID 31337); it is not Sepolia or mainnet. Redis is included and health-checked, but Redis Streams and independent stream consumers are not implemented in this phase.

## Troubleshooting

### Docker is installed but does not connect

`docker version` must show both Client and Server. If Server is missing or the Docker API pipe is unavailable, start Docker Desktop and wait for its Engine before running Compose.

### Compose says a variable is missing

You may have edited `backend\.env` instead of the repository-root `.env`. From the root, open the correct file with `notepad .env`, fill the eight required values above, save, and rerun `docker compose config --quiet`.

### A port is already allocated

Check the host-port values in root `.env`. The known Mongo conflict is `27017`; use `MONGO_HOST_PORT=27018`. For another conflict, choose a free host port for the corresponding `*_HOST_PORT` setting. Do not change the container-side ports in `docker-compose.yml`.

### A Docker image build fails

The earlier main-frontend peer conflict was resolved by aligning React 19 with React-Leaflet 5 and updating the lockfile. The field-panel image was also fixed by pinning pnpm 9.15.4, declaring the root package in its workspace config, and including the two shared shipment-map source files in the image. All Compose images built successfully together on 2026-10-05. If a build still fails, confirm you have these updated repository files, then capture the first failing service and error; avoid `--force` or `--legacy-peer-deps` as a substitute for a compatible dependency graph.

### Backend does not become healthy

Check MongoDB, MQTT, Redis, Hardhat and AI logs first; backend startup waits for their healthchecks. Verify root `.env` has non-placeholder values and rerun `docker compose ps` and `docker compose logs --tail 100 backend`.

### Login fails after seeding

Confirm `docker compose exec backend node scripts/seed.js` completed successfully, then use one of the four email addresses above with the exact `DEMO_SEED_PASSWORD` value from root `.env`. If you change that password, run the seed command again.

## Stop or reset the stack

For a Phase 5 upgrade on an existing chain, use the [companion-contract procedure](PHASE5_BLOCKCHAIN.md#upgrade-without-resetting-the-chain). Do not recreate Hardhat: its chain is in-memory. Rebuild the images, deploy the companion through the existing node, retain the original batch address, set `MERKLE_CONTRACT_ADDRESS` and recreate only backend/frontend. New sensor evidence uses Merkle roots; existing raw evidence remains accessible.

Stop containers while preserving MongoDB and other named volumes:

```powershell
docker compose down
```

Start again later with `docker compose up -d`. Avoid `docker compose down -v`: that deletes the Compose volumes, including seeded MongoDB records and local chain/artifact state.

## Current machine check (2026-10-05)

On 2026-10-05, Docker Client/Server `29.8.2` responded, `docker compose config --quiet` passed, and all seven service images built successfully. The operator's follow-up terminal screenshot then confirmed all nine Compose services healthy and the seed command completed with four demo accounts, three batches/policies, three inventory snapshots and 108 synthetic monthly order records. MongoDB was published on `127.0.0.1:27018` because port `27017` was occupied. The Field Operator account was added later in Phase 3B; rerun the seed script to create/update that account before signing in as that role. The root `.env` must contain fresh, non-placeholder secrets before startup; rotate them if they have been exposed in a screenshot or shared message.
