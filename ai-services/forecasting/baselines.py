"""Deterministic one-period demand forecasts; no clinical or real-world accuracy claim."""
import hashlib
import json
import math

METHODS = ("naive", "mean_3", "drift")

def validate(values):
    if not isinstance(values, list) or not 6 <= len(values) <= 240:
        raise ValueError("Provide 6–240 equally spaced chronological demand observations")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 or v > 1e9 for v in values):
        raise ValueError("Demand must be finite nonnegative numbers no larger than 1e9")
    return [float(v) for v in values]

def predict(history, method):
    if method == "naive": result = history[-1]
    elif method == "mean_3": result = sum(history[-3:]) / len(history[-3:])
    elif method == "drift": result = history[-1] + (history[-1] - history[0]) / (len(history) - 1)
    else: raise ValueError("Unknown baseline")
    return max(0.0, result)

def metrics(actual, predictions):
    errors = [p - a for a, p in zip(actual, predictions)]
    denominator = sum(abs(a) for a in actual)
    return {"mae": sum(abs(e) for e in errors) / len(errors),
            "rmse": math.sqrt(sum(e * e for e in errors) / len(errors)),
            "wape": sum(abs(e) for e in errors) / denominator if denominator else None,
            "observations": len(errors)}

def forecast(values, provenance=None):
    series = validate(values)
    # Select only on the prefix. Evaluate the fixed selection on unseen later points.
    cutoff = max(4, len(series) - max(2, len(series) // 4))
    selection = {method: metrics(series[3:cutoff], [predict(series[:i], method) for i in range(3, cutoff)]) for method in METHODS}
    selected = min(METHODS, key=lambda method: (selection[method]["mae"], METHODS.index(method)))
    comparison = {method: metrics(series[cutoff:], [predict(series[:i], method) for i in range(cutoff, len(series))]) for method in METHODS}
    return {"predicted_demand": int(math.ceil(predict(series, selected))), "model": selected,
            "model_version": "deterministic-baselines-v1", "horizon": 1, "unit": "doses per supplied period",
            "provenance": provenance or {"source": "caller-provided", "verification": "unverified", "synthetic": None},
            "series_sha256": hashlib.sha256(json.dumps(series, separators=(",", ":")).encode()).hexdigest(),
            "validation": {"strategy": "expanding-window; selection prefix then untouched chronological evaluation suffix",
                "selection_end_index_exclusive": cutoff, "selection": selection, "comparison": comparison, "selected_metrics": comparison[selected]},
            "explanation": f"{selected} had the lowest prefix rolling MAE; forecast uses the latest available observations. No random training or future observations are used.",
            "limitations": ["Small-sample retrospective error is not prospective validation", "No product/region mixing or irregular time gaps allowed", "Not an automatic purchase, dispatch or clinical decision"],
            "series_used": series[-10:]}
