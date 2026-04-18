from fastapi import APIRouter

router = APIRouter()

@router.post("/decision")
def decision(data: dict):
    demand = data["forecast_demand"]
    supply = data["historical_supply"]

    if demand > supply:
        decision = "Increase"
    elif demand < supply:
        decision = "Decrease"
    else:
        decision = "Balanced"

    return {
        "recommended_distribution": decision
    }