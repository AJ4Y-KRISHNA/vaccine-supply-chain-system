# Blockchain-Enabled Vaccine Supply Chain (Core Architecture)

## Layers & Responsibilities
- **Data Layer**: Ingest WHO MI4A/Gavi demand CSV, UNICEF shipment logs, IoT temp streams, and multilingual social feeds (Twitter/Reddit API or Kaggle dump). Normalize into `ingestion_*` tables (PostgreSQL) and store raw files in `/data/raw`.
- **AI Services (FastAPI – `ai-services/`)**
  - **Sentiment**: Multilingual BERT/XLM-R pipeline → score ∈ [0,1] with label (Positive/Neutral/Negative).
  - **Demand Forecast**: CNN-LSTM on rolling 12‑month vaccine volumes per country/vaccine type.
  - **Decision Engine / Oracle**: Combines sentiment + forecast + historical supply; if `forecast > current_stock * 1.2` or `sentiment < 0.4`, raise `risk_flag` and emit `requestNewBatch` transaction.
- **Blockchain Layer (Ethereum, Hardhat + ethers/web3)**: `VaccineSupplyChain` smart contract records batch creation & distribution states; every status transition triggers `recordDistribution` or `updateStatus`.
- **API Gateway (Express – `backend/`)**: Auth, CRUD for batches/shipments, and orchestration endpoint `/api/distribution/admin/distribute` that calls AI Decision service and writes blockchain receipt + MongoDB record.
- **Frontend (React + Tailwind)**: Role-based dashboards (Admin/Manufacturer/Distributor/Healthcare) reflecting screenshots; charts via Chart.js/Recharts, maps via a pluggable provider (Mapbox/Leaflet).

## End-to-End Data Flow (aligned to DFD)
1. **Process 1.0 Manufacturer**: Raw materials → `registerBatch` (smart contract) → batch metadata persisted in MongoDB/Postgres + on-chain hash.
2. **Process 2.0 Distributor**: Receives batch → updates distribution DB → ingests temp logs → calls `recordDistribution` when status changes `Pending→In Transit→Delivered`.
3. **Process 3.0 Healthcare Center**: Consumes inventory → pushes usage & appointments → feeds historical data to forecast API.
4. **Process 4.0 Admin/Government**: Pulls system reports, sentiment map, AI demand forecast; can trigger `/admin/distribute` which:
   - Calls FastAPI **Decision Engine** (`/decision/decide`) with sentiment text + 12‑month volumes + current stock.
   - If `risk_flag=true`, Oracle triggers `requestNewBatch` on Ethereum (Sepolia/Mainnet configurable).
   - MongoDB `Distribution` row stores demand/supply/txHash for audit.

## Real Data Sources (plug points)
- `WHO_MI4A_CSV` / `GAVI_DEMAND_CSV`: Historical demand per vaccine type.
- `UNICEF_SHIPMENTS_CSV`: Shipment volumes & routes (feeds Distributor + Forecast).
- `IOT_TEMP_STREAM_URL` or `TEMPERATURE_CSV`: 24/7 cold-chain telemetry.
- `SOCIAL_FEED_URL` (Twitter v2/Reddit) or `KAGGLE_COVID_TWEETS_PATH`: Sentiment corpus for BERT.

## Environment Contracts
- **Python AI**: `WHO_MI4A_CSV`, `UNICEF_SHIPMENTS_CSV`, `SOCIAL_FEED_URL`, `IOT_TEMP_STREAM_URL`, `WEB3_RPC_URL`, `WEB3_PRIVATE_KEY`, `CONTRACT_ADDRESS`.
- **Node Backend**: `MONGO_URI`, `RPC_URL`, `PRIVATE_KEY`, `CONTRACT_ADDRESS`, `AI_BASE_URL`.
- **Frontend**: `REACT_APP_API_BASE` for Express, `REACT_APP_MAPBOX_TOKEN` (if map enabled).

## Logging & Audit
- FastAPI logs every decision to `logs/oracle.log` with timestamp, inputs, forecast, sentiment, `risk_flag`, tx hash.
- Express stores tx hash + decision snapshot in MongoDB `distributions` for UI history.
- Smart contract events are the immutable source of truth for batch lifecycle.

## Minimal Deployment Path
1. Train/serve AI FastAPI (`uvicorn main:app --reload`).
2. Run Hardhat node or point to Sepolia; deploy `VaccineSupplyChain.sol`; export `CONTRACT_ADDRESS`.
3. Start Express gateway (`npm run start` in `backend/`).
4. Serve React frontend (`npm start` in `frontend/`) using API base URL.
