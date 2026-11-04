from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from .sentiment import get_sentiment_internal
from .forecast import get_forecast_internal
from ingestion.demand_dataset import load_dataset
import math

router = APIRouter()

class DecisionRequest(BaseModel):
    social_text: Optional[str] = None
    vaccination_history: Optional[List[float]] = None
    historical_data: Optional[List[float]] = None
    source_csv: Optional[str] = None
    current_stock: Optional[float] = 0
    target_center: Optional[str] = "UNKNOWN"

class FeedbackDecisionRequest(BaseModel):
    patientFeedbackText: str
    feedbackCategory: str
    severity: str
    vaccineBatchId: str
    appointmentId: Optional[str] = None
    patientAgeGroup: Optional[str] = None
    region: Optional[str] = "UNKNOWN"
    submittedBy: Optional[str] = "healthcare-operator"
    sentimentScore: Optional[float] = None
    sentimentLabel: Optional[str] = None
    scoringStatus: Optional[str] = None


@router.post("/decide")
async def make_distribution_decision(data: DecisionRequest):
    try:
        # 1) Sentiment (Multilingual BERT/XLM-R)
        social_text = data.social_text or "Public sentiment data not provided."
        sentiment = await get_sentiment_internal(social_text)

        # Explicit baseline/provenance. AI is advisory; only the backend signs transactions.
        series, provenance = (data.vaccination_history, {"source": "caller-provided", "synthetic": None}) if data.vaccination_history is not None else load_dataset(data.source_csv, 12)
        forecast = await get_forecast_internal(series)

        # 3) Decision Logic
        current_stock = float(data.current_stock or 0)
        if not math.isfinite(current_stock) or current_stock < 0:
            raise ValueError("current_stock must be finite and nonnegative")
        forecast_val = float(forecast["demand"])
        historical_data = data.historical_data or []
        historical_avg = (
            sum(float(value) for value in historical_data) / len(historical_data)
            if historical_data
            else forecast_val
        )
        adjusted_demand = max(forecast_val, historical_avg)
        risk_flag = (adjusted_demand > current_stock * 1.2) or (sentiment["score"] < 0.4)

        decision = {
            "sentiment_score": sentiment["score"],
            "sentiment_label": sentiment["sentiment"],
            "forecast_demand": forecast_val,
            "historical_average": historical_avg,
            "adjusted_demand": adjusted_demand,
            "current_stock": current_stock,
            "recommended_units": math.ceil(max(0.0, (adjusted_demand * 1.1) - current_stock)),
            "risk_flag": risk_flag,
            "status": "Needs Replenishment" if risk_flag else "Stable",
        }

        return {
            "decision": decision,
            "tx_hash": None,
            "advisory_only": True,
            "forecast_provenance": provenance,
            "forecast_validation": forecast["validation"],
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/feedback-risk")
async def make_feedback_decision(data: FeedbackDecisionRequest):
    try:
        text = data.patientFeedbackText or ""
        sentiment = (
            {
                "score": float(data.sentimentScore),
                "sentiment": data.sentimentLabel,
                "scoring_status": data.scoringStatus or "External Input",
            }
            if data.sentimentScore is not None and data.sentimentLabel
            else await get_sentiment_internal(text)
        )

        severity = str(data.severity or "Low")
        risk_reasons = []
        if sentiment["sentiment"] == "Negative":
            risk_reasons.append("Negative sentiment feedback detected")
        if severity == "High":
            risk_reasons.append("High severity feedback reported")
        if "storage" in str(data.feedbackCategory or "").lower():
            risk_reasons.append("Storage concern category requires immediate review")

        risk_flag = bool(risk_reasons)

        return {
            "riskFlagContribution": risk_flag,
            "riskReasons": risk_reasons,
            "scoringStatus": sentiment.get("scoring_status", "AI Model"),
            "decisionSummary": (
                f"Feedback flagged for review in {data.region} for batch {data.vaccineBatchId}"
                if risk_flag
                else f"Feedback logged with stable risk profile for batch {data.vaccineBatchId}"
            ),
            "decisionEngineStatus": "Processed",
            "sentimentScore": sentiment["score"],
            "sentimentLabel": sentiment["sentiment"],
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
