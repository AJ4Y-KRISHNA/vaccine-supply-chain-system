import os
import re
import time
import uuid
from fastapi import FastAPI
from starlette.requests import Request
from starlette.responses import Response
from routes.forecast import router as forecast_router
from routes.decision import router as decision_router
from routes.sentiment import router as sentiment_router
from routes.anomaly import router as anomaly_router
from routes.analytics import router as analytics_router
from utils.logger import configure_logging, correlation_id_context

# Ensure log directory exists
os.makedirs("logs", exist_ok=True)

logger = configure_logging()

app = FastAPI()


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    candidate = request.headers.get("x-correlation-id", "").strip()
    correlation_id = candidate if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", candidate) else str(uuid.uuid4())
    token = correlation_id_context.set(correlation_id)
    started = time.perf_counter()
    status_code = 500
    try:
        response: Response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Correlation-ID"] = correlation_id
        return response
    finally:
        logger.info("http.request.completed", extra={
            "event": "http.request.completed",
            "correlation_id": correlation_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": status_code,
            "duration_ms": round((time.perf_counter() - started) * 1000, 2),
        })
        correlation_id_context.reset(token)

# Register routes
app.include_router(forecast_router, prefix="/forecast", tags=["Forecast"])
app.include_router(decision_router, prefix="/decision", tags=["Decision"])
app.include_router(sentiment_router, prefix="/sentiment", tags=["Sentiment"])
app.include_router(anomaly_router, prefix="/anomaly", tags=["Advisory anomaly inference"])
app.include_router(analytics_router, prefix="/analytics", tags=["Synthetic analytics"])

# Root route
@app.get("/")
def home():
    return {"message": "AI Vaccine Supply Chain Service Running"}
