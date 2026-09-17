from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from forecasting.baselines import forecast
from ingestion.demand_dataset import load_dataset

router = APIRouter()

async def get_forecast_internal(vaccination_data: List[float]):
    result = forecast(vaccination_data)
    return {"demand": result["predicted_demand"], **result}

# Request Schema
class ForecastRequest(BaseModel):
    vaccination_data: Optional[List[float]] = None
    source_csv: Optional[str] = None
    months: Optional[int] = 12

# API Endpoint
@router.post("/forecast")
async def forecast_demand(data: ForecastRequest):
    try:
        if data.vaccination_data is not None:
            return forecast(data.vaccination_data)
        series, provenance = load_dataset(data.source_csv, data.months or 12)
        return forecast(series, provenance)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
