from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from forecasting.cnn_lstm_model import VaccineDemandForecast
from ingestion.data_loader import load_demand_series

router = APIRouter()

model = VaccineDemandForecast()

async def get_forecast_internal(vaccination_data: List[float]):
    model.train(vaccination_data)
    prediction = model.predict(vaccination_data)
    return {"demand": prediction}

# Request Schema
class ForecastRequest(BaseModel):
    vaccination_data: Optional[List[float]] = None
    source_csv: Optional[str] = None
    months: Optional[int] = 12

# API Endpoint
@router.post("/forecast")
async def forecast_demand(data: ForecastRequest):
    try:
        series = data.vaccination_data or load_demand_series(
            source_path=data.source_csv,
            n_months=data.months or 12,
        )
        res = await get_forecast_internal(series)
        return {
            "predicted_demand": res["demand"],
            "series_used": series[-10:],  # return tail for debugging
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
