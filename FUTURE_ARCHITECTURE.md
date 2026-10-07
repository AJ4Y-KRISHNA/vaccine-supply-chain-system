# Target / Roadmap Architecture — Not Yet Implemented

This document preserves the ambitious target described by the former architecture document. It is a design proposal, not a statement of current capability; the implemented system is documented in [ARCHITECTURE.md](ARCHITECTURE.md). The design below has not been verified against the current source, deployment environment, data licenses, or operational requirements.

## Target layers and responsibilities

- **Data layer:** Ingest WHO MI4A/Gavi demand CSVs, UNICEF shipment logs, IoT temperature streams, and multilingual social feeds such as Twitter/Reddit APIs or Kaggle datasets. Normalize them into `ingestion_*` PostgreSQL tables and store raw files under `/data/raw`.
- **AI services (FastAPI):**
  - **Sentiment:** Multilingual BERT/XLM-R pipeline producing a score from 0 to 1 and Positive/Neutral/Negative label.
  - **Demand forecast:** CNN-LSTM using rolling 12-month vaccine volumes per country and vaccine type.
  - **Decision engine / Oracle:** Combine sentiment, forecast and historical supply. Under the former proposal, if `forecast > current_stock * 1.2` or `sentiment < 0.4`, raise a risk flag and emit a `requestNewBatch` transaction.
- **Blockchain layer:** Ethereum with the `VaccineSupplyChain` contract records batch creation and distribution states. Every status transition is intended to trigger `recordDistribution` or `updateStatus`.
- **API gateway (Express):** Authenticate users, expose batch/shipment CRUD, and orchestrate an endpoint such as `/api/distribution/admin/distribute` that calls the AI decision service and records blockchain receipts and MongoDB data.
- **Frontend:** Role-based React + Tailwind dashboards for Admin, Manufacturer, Distributor and Healthcare; charts via Chart.js/Recharts and a pluggable map provider such as Mapbox or Leaflet.

## Target end-to-end data flow

1. **Manufacturer:** Raw materials → `registerBatch` on the smart contract → batch metadata in MongoDB/PostgreSQL plus an on-chain hash.
2. **Distributor:** Receive batch → update distribution data → ingest temperature logs → call `recordDistribution` when status changes from Pending to In Transit to Delivered.
3. **Healthcare center:** Record usage and appointments → feed historical usage to the forecast API.
4. **Admin/government:** Review reports, sentiment and demand forecasts; optionally trigger an admin distribution operation that calls FastAPI `/decision/decide` with sentiment text, 12-month volumes and current stock. In the original proposal, a risk flag could lead the Oracle to call `requestNewBatch` on Ethereum, while a MongoDB Distribution record stores demand, supply and transaction hash for audit.

## Proposed data-source plug points

- `WHO_MI4A_CSV` or `GAVI_DEMAND_CSV` for historical demand by country and vaccine type.
- `UNICEF_SHIPMENTS_CSV` for shipment volumes and routes.
- `IOT_TEMP_STREAM_URL` or `TEMPERATURE_CSV` for continuous cold-chain telemetry.
- `SOCIAL_FEED_URL` (Twitter v2/Reddit) or `KAGGLE_COVID_TWEETS_PATH` for sentiment inputs.

These are proposed source integrations. Their credentials, terms, licensing, schemas, provenance and operational availability have not been validated here.

## Proposed environment contracts

- **Python AI:** `WHO_MI4A_CSV`, `UNICEF_SHIPMENTS_CSV`, `SOCIAL_FEED_URL`, `IOT_TEMP_STREAM_URL`, `WEB3_RPC_URL`, `WEB3_PRIVATE_KEY` and `CONTRACT_ADDRESS`.
- **Node backend:** `MONGO_URI`, `RPC_URL`, `PRIVATE_KEY`, `CONTRACT_ADDRESS` and `AI_BASE_URL`.
- **Frontend:** `REACT_APP_API_BASE` and optional `REACT_APP_MAPBOX_TOKEN`.

These names reproduce the earlier design proposal; they are not a verified configuration contract for the current project.

## Proposed logging and audit

The original target called for FastAPI to log every decision to `logs/oracle.log` with timestamp, inputs, forecast, sentiment, risk flag and transaction hash; Express to store decision snapshots and transaction hashes in MongoDB; and smart-contract events to serve as the immutable lifecycle record. Those end-to-end guarantees require implementation and independent verification before being claimed.

## Proposed deployment path

1. Train and serve the Python FastAPI models.
2. Start Hardhat or connect to Sepolia, deploy `VaccineSupplyChain.sol` and configure `CONTRACT_ADDRESS`.
3. Start the Express gateway.
4. Serve the React application against the configured API.

The current repository configuration is local Hardhat-only; the public-network deployment described above is future work, not an available deployment path.
