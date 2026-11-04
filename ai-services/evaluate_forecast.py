"""Reproducible synthetic benchmark printed to stdout; no claim of observed demand."""
import json
import random
from forecasting.baselines import forecast

def evaluate():
    randomizer = random.Random(1729)
    seasonal = [0, 30, 80, 120, 90, 20, -30, -60, 0, 70, 140, 50]
    series = [1000 + 20 * i + seasonal[i % 12] + randomizer.randint(-25, 25) for i in range(48)]
    result = forecast(series, {"source": "48-period trend/seasonality/noise fixture v1", "seed": 1729, "synthetic": True})
    return {"series": series, **result, "research_status": "Software benchmark only; not a real vaccine-demand accuracy result"}

if __name__ == "__main__": print(json.dumps(evaluate(), indent=2))
