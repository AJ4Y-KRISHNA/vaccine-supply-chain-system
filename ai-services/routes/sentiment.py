from fastapi import APIRouter
from pydantic import BaseModel
from sentiment.bert_sentiment import MultilingualSentiment

router = APIRouter()

# Load model once
model = MultilingualSentiment()

def normalize_sentiment(result):
    label = str(result.get("sentiment", "")).strip()
    confidence = float(result.get("confidence", 0) or 0)
    scoring_status = result.get("scoring_status", "AI Model")

    if label.lower() in {"positive", "neutral", "negative"}:
        sentiment = label.capitalize()
        score = float(result.get("score", confidence or (0.8 if sentiment == "Positive" else 0.5 if sentiment == "Neutral" else 0.25)))
    else:
        try:
            stars = int(label[0])
        except Exception:
            stars = 3

        score = stars / 5.0
        if score >= 0.67:
            sentiment = "Positive"
        elif score < 0.4:
            sentiment = "Negative"
        else:
            sentiment = "Neutral"

    return {
        "sentiment": sentiment,
        "score": score,
        "confidence": confidence,
        "raw_label": label,
        "sentimentLabel": sentiment,
        "sentimentScore": score,
        "scoringStatus": scoring_status,
    }

# Internal usage for Decision Engine
async def get_sentiment_internal(text: str):
    result = model.analyze(text)
    normalized = normalize_sentiment(result)
    return {
        "score": normalized["score"],
        "sentiment": normalized["sentiment"],
        "scoring_status": normalized["scoringStatus"],
    }

# Request Schema
class SentimentRequest(BaseModel):
    text: str

# API Endpoint
@router.post("/sentiment")
def analyze_sentiment(data: SentimentRequest):
    result = model.analyze(data.text)
    return normalize_sentiment(result)
