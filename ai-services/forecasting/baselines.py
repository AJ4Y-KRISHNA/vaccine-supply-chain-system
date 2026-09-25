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

def _forecast_explanation(series, selected, predicted, supply_context=None):
    latest = series[-1]
    prior_window = series[-4:-1]
    prior_average = sum(prior_window) / len(prior_window)
    recent_change = latest - prior_average
    if recent_change > 0:
        trend_label = "above"
    elif recent_change < 0:
        trend_label = "below"
    else:
        trend_label = "equal to"

    if selected == "naive":
        estimate = latest
        calculation = f"latest observation = {latest:g} doses; rounded up to {predicted}"
        inputs = [{"label": "Latest observation", "demand_doses": latest, "contribution_doses": latest}]
    elif selected == "mean_3":
        window = series[-3:]
        estimate = sum(window) / len(window)
        calculation = f"({window[0]:g} + {window[1]:g} + {window[2]:g}) / 3 = {estimate:g}; rounded up to {predicted}"
        inputs = [
            {"label": f"Observation {index} of the latest 3", "demand_doses": value,
             "contribution_doses": value / len(window)}
            for index, value in enumerate(window, start=1)
        ]
    else:
        slope = (series[-1] - series[0]) / (len(series) - 1)
        estimate = max(0.0, latest + slope)
        calculation = (
            f"latest observation {latest:g} + endpoint change per period "
            f"(({latest:g} - {series[0]:g}) / {len(series) - 1} = {slope:g}) "
            f"= {estimate:g}; rounded up to {predicted}"
        )
        inputs = [
            {"label": "First observation", "demand_doses": series[0]},
            {"label": "Latest observation", "demand_doses": latest},
            {"label": "Periods between endpoints", "periods": len(series) - 1},
            {"label": "Endpoint change per period", "change_doses_per_period": slope},
        ]

    context = supply_context or {}
    context_available = context.get("status") == "available"
    if context_available:
        stock_detail = (
            f"{context.get('current_available_stock_doses', 0)} doses are currently eligible and unallocated "
            f"within {context.get('scope', 'the reported scope')} at {context.get('captured_at', 'the snapshot time')}."
        )
        quarantine_detail = (
            f"{context.get('active_quarantine_batch_count', 0)} batch(es) have active quality holds; "
            f"{context.get('quarantined_unallocated_doses', 0)} unallocated dose(s) are excluded from eligible stock."
        )
    else:
        stock_detail = "Current available stock was not provided, so this response cannot quantify supply coverage."
        quarantine_detail = "Active quarantine context was not provided, so this response cannot quantify held stock."

    return {
        "version": "heuristic-baseline-explanation-v1",
        "methodology": "Rule-based explanation of a deterministic baseline; not SHAP, LIME, or model-internal attribution.",
        "selected_baseline": selected,
        "selection_basis": "Selected by the lowest rolling mean absolute error on the chronological selection prefix; the later evaluation suffix is not used for selection.",
        "predicted_demand_doses": predicted,
        "unrounded_estimate_doses": estimate,
        "calculation": calculation,
        "inputs": inputs,
        "recent_volume_trend": {
            "latest_observation_doses": latest,
            "previous_three_period_average_doses": prior_average,
            "change_from_previous_three_period_average_doses": recent_change,
            "description": f"The latest observation is {abs(recent_change):g} doses {trend_label} the average of the prior three periods.",
            "used_as_a_separate_model_component": False,
        },
        "seasonality": {
            "modeled": False,
            "description": "No seasonal component is modeled by the selected baseline.",
        },
        "supply_context": {
            "status": "available" if context_available else "unavailable",
            "scope": context.get("scope", "not provided"),
            "vaccine_type": context.get("vaccine_type"),
            "total_unallocated_stock_doses": context.get("total_unallocated_stock_doses"),
            "current_available_stock_doses": context.get("current_available_stock_doses"),
            "active_quarantine_batch_count": context.get("active_quarantine_batch_count"),
            "quarantined_unallocated_doses": context.get("quarantined_unallocated_doses"),
            "unavailable_unallocated_stock_doses": context.get("unavailable_unallocated_stock_doses"),
            "captured_at": context.get("captured_at"),
            "used_to_change_predicted_demand": False,
            "stock_description": stock_detail,
            "quarantine_description": quarantine_detail,
            "interpretation": "Supply and quarantine values describe inventory context only; they do not adjust the predicted-demand number.",
        },
    }


def forecast(values, provenance=None, supply_context=None):
    series = validate(values)
    # Select only on the prefix. Evaluate the fixed selection on unseen later points.
    cutoff = max(4, len(series) - max(2, len(series) // 4))
    selection = {method: metrics(series[3:cutoff], [predict(series[:i], method) for i in range(3, cutoff)]) for method in METHODS}
    selected = min(METHODS, key=lambda method: (selection[method]["mae"], METHODS.index(method)))
    comparison = {method: metrics(series[cutoff:], [predict(series[:i], method) for i in range(cutoff, len(series))]) for method in METHODS}
    predicted = int(math.ceil(predict(series, selected)))
    return {"predicted_demand": predicted, "model": selected,
            "model_version": "deterministic-baselines-v1", "horizon": 1, "unit": "doses per supplied period",
            "provenance": provenance or {"source": "caller-provided", "verification": "unverified", "synthetic": None},
            "series_sha256": hashlib.sha256(json.dumps(series, separators=(",", ":")).encode()).hexdigest(),
            "validation": {"strategy": "expanding-window; selection prefix then untouched chronological evaluation suffix",
                "selection_end_index_exclusive": cutoff, "selection": selection, "comparison": comparison, "selected_metrics": comparison[selected]},
            "explanation": f"{selected} had the lowest prefix rolling MAE; forecast uses the latest available observations. No random training or future observations are used.",
            "explanation_breakdown": _forecast_explanation(series, selected, predicted, supply_context),
            "limitations": ["Small-sample retrospective error is not prospective validation", "No product/region mixing or irregular time gaps allowed", "Not an automatic purchase, dispatch or clinical decision"],
            "series_used": series[-10:]}
