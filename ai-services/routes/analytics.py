from typing import List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from forecasting.regional import forecast_regional
from forecasting.allocation import optimize

router = APIRouter()


class RegionalRequest(BaseModel):
    values: List[float] = Field(min_length=30, max_length=120)
    horizon: int = Field(default=6, ge=3, le=6)
    last_period: str = Field(pattern=r"^\d{4}-\d{2}$")


@router.post("/regional")
def regional(request: RegionalRequest):
    try:
        return forecast_regional(request.values, request.horizon, request.last_period)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


class AllocationRequest(BaseModel):
    inventory: list[dict] = Field(max_length=300)
    demand: list[dict] = Field(max_length=100)
    capacity: int = Field(ge=0, le=10000000)


@router.post("/allocate")
def allocate(request: AllocationRequest):
    try:
        return optimize(request.inventory, request.demand, request.capacity)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
