import os
from fastapi import FastAPI
from routes.forecast import router as forecast_router
from routes.decision import router as decision_router
from routes.sentiment import router as sentiment_router
from utils.logger import configure_logging

# Ensure log directory exists
os.makedirs("logs", exist_ok=True)

logger = configure_logging()

app = FastAPI()

# Register routes
app.include_router(forecast_router, prefix="/forecast", tags=["Forecast"])
app.include_router(decision_router, prefix="/decision", tags=["Decision"])
app.include_router(sentiment_router, prefix="/sentiment", tags=["Sentiment"])

# Root route
@app.get("/")
def home():
    return {"message": "AI Vaccine Supply Chain Service Running"}
