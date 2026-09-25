from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pydantic import Field
from typing import List, Literal, Optional
from forecasting.baselines import forecast
from ingestion.demand_dataset import load_dataset

router = APIRouter()

async def get_forecast_internal(vaccination_data: List[float]):
    result = forecast(vaccination_data)
    return {"demand": result["predicted_demand"], **result}

# Request Schema
class ForecastSupplyContext(BaseModel):
    status: Literal["available"]
    scope: str
    vaccine_type: Optional[str] = None
    total_unallocated_stock_doses: int = Field(ge=0)
    current_available_stock_doses: int = Field(ge=0)
    active_quarantine_batch_count: int = Field(ge=0)
    quarantined_unallocated_doses: int = Field(ge=0)
    unavailable_unallocated_stock_doses: int = Field(ge=0)
    captured_at: Optional[str] = None


class ForecastRequest(BaseModel):
    vaccination_data: Optional[List[float]] = None
    source_csv: Optional[str] = None
    months: Optional[int] = 12
    supply_context: Optional[ForecastSupplyContext] = None


def _supply_context_dict(context):
    if context is None:
        return None
    return context.model_dump() if hasattr(context, "model_dump") else context.dict()

# API Endpoint
@router.post("/forecast")
async def forecast_demand(data: ForecastRequest):
    try:
        if data.vaccination_data is not None:
            context = _supply_context_dict(data.supply_context)
            return forecast(data.vaccination_data, supply_context=context)
        series, provenance = load_dataset(data.source_csv, data.months or 12)
        context = _supply_context_dict(data.supply_context)
        return forecast(series, provenance, context)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
