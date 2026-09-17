# Vaccine supply-chain software prototype

Existing React + Express/Mongoose + Python + Solidity architecture, extended with deterministic virtual sensor telemetry, policy-based explainable cold-chain events, reviewed quarantine clearance, local audit-hash anchoring and advisory supply planning. **Software-only, synthetic demo/test use. Not a clinical system or production-certified deployment.**

## Current evidence

See [ordered roadmap](docs/ORDERED_ROADMAP_PROGRESS.md), [integrated acceptance](docs/SYSTEM_ACCEPTANCE.md), and [synthetic evaluation](docs/RESEARCH_EVALUATION.md). Existing demo records were reconciled with before-image journals, not deleted; all seven relationship checks now pass. The forecast is a deterministic advisory baseline; the CNN-LSTM is experimental. The planner is a constrained FEFO heuristic, not a global optimizer.

## Run locally

1. Start local MongoDB. Review `backend/.env.example`; keep random JWT/refresh/temperature API secrets in ignored `backend/.env`. Existing demo passwords were hashed without changing their values; log in again because old sessions were invalidated. Do not use these accounts on a public service.
2. In `blockchain`, run `npm test`, then `npm run node` (loopback only). In a second terminal run `npm run deploy:local`. Configure its address in backend `.env`; explicitly set `LOCAL_CHAIN_DEMO=true` for public Hardhat **test** accounts, and `AUDIT_ANCHOR_ENABLED=true` if audit anchoring is wanted. Never fund these keys. See [chain guide](docs/LOCAL_BLOCKCHAIN.md).
3. In `ai-services`, run `python -m uvicorn main:app --host 127.0.0.1 --port 8000`. Default forecasting needs no model download or training. Sentiment is a labeled heuristic unless explicitly opting into the experimental BERT model.
4. In `backend`, run `npm start` (or `node server.js`). In `frontend`, run `npm start` (or `node node_modules/react-scripts/bin/react-scripts.js start`). The backend binds to loopback by default.
5. Admin/Manufacturer dashboards expose simulator creation and lifecycle, policy approval, alert/quality-review controls and opt-in silence monitoring. Admin also has the constrained supply-planning preview. See [simulator](docs/IOT_SIMULATOR.md), [quality review](docs/TEMPERATURE_ALERTS.md), and [planning](docs/SUPPLY_PLANNING.md).

Older batches with unknown expiry or unreleased placeholders are intentionally excluded from planning. Do not invent missing operational facts. New batch creation APIs accept `expiresAt`; generator temperature bounds are simulation settings, not an approved medical policy.

## Verify

- `backend`: `npm test`, `npm run audit:integrity`, `node scripts/runSystemAcceptance.js --execute`, `node scripts/evaluatePrototype.js`.
- `frontend`: `npm test -- --watchAll=false --runInBand`, `npm run build`.
- `blockchain`: `npm test`.
- `ai-services`: `python -m unittest discover -s tests -v`, `python evaluate_forecast.py`.

Acceptance/evaluation create disposable uniquely named databases and clean up only those databases. They do not reseed `vaccineDB`. No paid API, public chain, hardware or cloud deployment is required. [Security boundaries](docs/SECURITY_HARDENING.md) and remaining research/production gates are documented explicitly.
