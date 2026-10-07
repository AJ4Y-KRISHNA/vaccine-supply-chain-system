from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

from anomaly_detection import detect_anomaly

router = APIRouter()


class TelemetryPoint(BaseModel):
    temperature: float = Field(ge=-100, le=100, allow_inf_nan=False)
    humidity: Optional[float] = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    recorded_at: Optional[datetime] = None
    latitude: Optional[float] = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180, allow_inf_nan=False)


class AnomalyRequest(BaseModel):
    temperature: float = Field(ge=-100, le=100, allow_inf_nan=False)
    humidity: Optional[float] = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    history: List[TelemetryPoint] = Field(default_factory=list, max_length=1000)
    current_timestamp: Optional[datetime] = None
    policy_minimum_temperature: Optional[float] = Field(default=None, ge=-100, le=100, allow_inf_nan=False)
    policy_maximum_temperature: Optional[float] = Field(default=None, ge=-100, le=100, allow_inf_nan=False)
    trend_horizon_minutes: float = Field(default=15, gt=0, le=120, allow_inf_nan=False)
    batch_id: Optional[str] = Field(default=None, max_length=160)
    device_id: Optional[str] = Field(default=None, max_length=160)
    latitude: Optional[float] = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    detector_cutoff: Optional[float] = Field(default=None, gt=0, le=1000, allow_inf_nan=False)


class SequenceRequest(BaseModel):
    readings: List[AnomalyRequest] = Field(min_length=1, max_length=1000)
    detector_cutoff: Optional[float] = Field(default=None, gt=0, le=1000, allow_inf_nan=False)


def _detect(data, history, cutoff=None):
    return detect_anomaly(
        data.temperature, data.humidity,
        [{"temperature": point.temperature, "humidity": point.humidity,
          "recorded_at": point.recorded_at.isoformat() if point.recorded_at else None,
          "latitude": point.latitude, "longitude": point.longitude} for point in history],
        data.current_timestamp.isoformat() if data.current_timestamp else None,
        data.policy_minimum_temperature, data.policy_maximum_temperature, data.trend_horizon_minutes,
        data.latitude, data.longitude, cutoff if cutoff is not None else data.detector_cutoff,
    )


@router.post("/detect")
async def detect_telemetry_anomaly(data: AnomalyRequest):
    try:
        result = _detect(data, data.history)
        result["stream"] = {"batch_id": data.batch_id, "device_id": data.device_id}
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/detect/run")
async def detect_telemetry_run(data: SequenceRequest):
    """Score one chronological synthetic run efficiently; this is advisory only."""
    try:
        history = []
        output = []
        for reading in data.readings:
            output.append(_detect(reading, history, data.detector_cutoff))
            history.append(TelemetryPoint(temperature=reading.temperature, humidity=reading.humidity,
                recorded_at=reading.current_timestamp, latitude=reading.latitude, longitude=reading.longitude))
            # Keep the full 30-minute horizon at fast sampling, not 100 samples.
            if len(history) > 1000:
                history.pop(0)
        return {"readings": output, "model": output[0]["model"], "advisory_only": True}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
