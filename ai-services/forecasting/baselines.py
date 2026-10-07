"""Historical-demand baselines and Holt exponential smoothing; no clinical claim."""
import hashlib
import json
import math
import re

DEFAULT_HORIZON = 6
MAX_HORIZON = 24
HOLT_ALPHA = 0.5
HOLT_BETA = 0.25

METHODS = ("naive", "mean_3", "drift", "holt_linear")
SEASONAL_METHOD = "seasonal_naive_12"
SEASONAL_PERIOD = 12

def validate(values):
    if not isinstance(values, list) or not 6 <= len(values) <= 240:
        raise ValueError("Provide 6–240 equally spaced chronological demand observations")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 or v > 1e9 for v in values):
        raise ValueError("Demand must be finite nonnegative numbers no larger than 1e9")
    return [float(v) for v in values]

def holt_components(history):
    level = history[0]
    trend = history[1] - history[0]
    for actual in history[1:]:
        previous_level = level
        level = HOLT_ALPHA * actual + (1 - HOLT_ALPHA) * (level + trend)
        trend = HOLT_BETA * (level - previous_level) + (1 - HOLT_BETA) * trend
    return level, trend

def predict(history, method):
    if method == "naive": result = history[-1]
    elif method == "mean_3": result = sum(history[-3:]) / len(history[-3:])
    elif method == "drift": result = history[-1] + (history[-1] - history[0]) / (len(history) - 1)
    elif method == "holt_linear":
        level, trend = holt_components(history)
        result = level + trend
    elif method == SEASONAL_METHOD:
        if len(history) < SEASONAL_PERIOD:
            raise ValueError("Seasonal-naive forecast requires at least 12 historical periods")
        result = history[-SEASONAL_PERIOD]
    else: raise ValueError("Unknown baseline")
    return max(0.0, result)

def multi_step_forecast(history, method, horizon):
    if method == "holt_linear":
        level, trend = holt_components(history)
        estimates = [max(0.0, level + trend * step) for step in range(1, horizon + 1)]
    elif method == "drift":
        slope = (history[-1] - history[0]) / (len(history) - 1)
        estimates = [max(0.0, history[-1] + slope * step) for step in range(1, horizon + 1)]
    elif method == SEASONAL_METHOD:
        if len(history) < SEASONAL_PERIOD:
            raise ValueError("Seasonal-naive forecast requires at least 12 historical periods")
        estimates = [history[-SEASONAL_PERIOD + ((step - 1) % SEASONAL_PERIOD)] for step in range(1, horizon + 1)]
    elif method == "mean_3":
        value = sum(history[-3:]) / 3
        estimates = [value] * horizon
    else:
        estimates = [history[-1]] * horizon
    return [int(math.ceil(value)) for value in estimates]

def forecast_period_labels(provenance, horizon):
    last_period = (provenance or {}).get("last_period")
    if isinstance(last_period, str) and re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", last_period):
        year, month = map(int, last_period.split("-"))
        labels = []
        for step in range(1, horizon + 1):
            index = year * 12 + month - 1 + step
            labels.append(f"{index // 12:04d}-{index % 12 + 1:02d}")
        return labels
    return [f"period+{step}" for step in range(1, horizon + 1)]

def metrics(actual, predictions):
    errors = [p - a for a, p in zip(actual, predictions)]
    denominator = sum(abs(a) for a in actual)
    nonzero = [abs(error) / abs(value) for value, error in zip(actual, errors) if value != 0]
    return {"mae": sum(abs(e) for e in errors) / len(errors),
            "rmse": math.sqrt(sum(e * e for e in errors) / len(errors)),
            "wape": sum(abs(e) for e in errors) / denominator if denominator else None,
            "mape": sum(nonzero) / len(nonzero) * 100 if nonzero else None,
            "mape_observations": len(nonzero),
            "mape_excluded_zero_months": len(errors) - len(nonzero),
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
    elif selected == "drift":
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
    elif selected == "holt_linear":
        level, slope = holt_components(series)
        estimate = max(0.0, level + slope)
        calculation = (f"Holt linear exponential smoothing (alpha={HOLT_ALPHA:g}, beta={HOLT_BETA:g}) "
                       f"fitted level={level:g}, trend={slope:g} doses/period; next-period estimate {estimate:g}; rounded up to {predicted}")
        inputs = [{"label": "Fitted smoothed level", "demand_doses": level},
                  {"label": "Fitted smoothed trend", "change_doses_per_period": slope},
                  {"label": "Level smoothing alpha", "value": HOLT_ALPHA},
                  {"label": "Trend smoothing beta", "value": HOLT_BETA}]
    else:
        estimate = series[-SEASONAL_PERIOD]
        calculation = (
            f"observation {SEASONAL_PERIOD} supplied periods before the forecast "
            f"= {estimate:g} doses; rounded up to {predicted}"
        )
        inputs = [{"label": "Same seasonal period in the previous cycle", "demand_doses": estimate}]

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
            "modeled": selected == SEASONAL_METHOD,
            "periods": SEASONAL_PERIOD if selected == SEASONAL_METHOD else None,
            "description": ("The selected seasonal-naive baseline reuses the observation from 12 supplied periods earlier; this is a simple seasonal comparator, not a learned seasonal model."
                if selected == SEASONAL_METHOD else "No seasonal component is used by the selected baseline."),
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


def forecast(values, provenance=None, supply_context=None, horizon=DEFAULT_HORIZON):
    series = validate(values)
    if isinstance(horizon, bool) or not isinstance(horizon, int) or not 1 <= horizon <= MAX_HORIZON:
        raise ValueError(f"Forecast horizon must be a whole number from 1 to {MAX_HORIZON}")
    source_provenance = provenance or {"source": "caller-provided", "verification": "unverified", "synthetic": None}
    # Seasonal comparison is only meaningful for explicitly monthly, contiguous
    # series with at least two annual cycles. Event-level caller arrays do not
    # imply calendar seasonality, even if they happen to contain 24 points.
    supports_monthly_seasonality = source_provenance.get("period") == "month" and len(series) >= 2 * SEASONAL_PERIOD
    methods = (*METHODS, SEASONAL_METHOD) if supports_monthly_seasonality else METHODS
    # Select only on the prefix. Every candidate uses the same expanding-window
    # folds; the seasonal candidate starts once one full cycle is available.
    cutoff = max(4, len(series) - max(2, len(series) // 4))
    fold_start = SEASONAL_PERIOD if SEASONAL_METHOD in methods else 3
    selection = {method: metrics(series[fold_start:cutoff], [predict(series[:i], method) for i in range(fold_start, cutoff)]) for method in methods}
    selected = min(methods, key=lambda method: (selection[method]["mae"], methods.index(method)))
    comparison = {method: metrics(series[cutoff:], [predict(series[:i], method) for i in range(cutoff, len(series))]) for method in methods}
    periods = forecast_period_labels(source_provenance, horizon)
    values = multi_step_forecast(series, selected, horizon)
    predicted = values[0]
    return {"predicted_demand": predicted, "model": selected,
            "model_version": "historical-holt-and-baselines-v3", "horizon": horizon, "unit": "doses per supplied period",
            "forecast_periods": [{"period": period, "demand_doses": value} for period, value in zip(periods, values)],
            "provenance": source_provenance,
            "series_sha256": hashlib.sha256(json.dumps(series, separators=(",", ":")).encode()).hexdigest(),
            "validation": {"strategy": "expanding-window; shared selection folds on the prefix then untouched chronological evaluation suffix",
                "selection_start_index": fold_start, "selection_end_index_exclusive": cutoff, "selection": selection, "comparison": comparison, "selected_metrics": comparison[selected]},
            "explanation": f"{selected} had the lowest prefix rolling MAE; forecast uses the latest available observations. No random training or future observations are used.",
            "explanation_breakdown": _forecast_explanation(series, selected, predicted, supply_context),
            "limitations": ["Small-sample retrospective error is not prospective validation", "Holt smoothing is fitted on the supplied order history; no external/live demand feeds are used", "No product/region mixing or irregular time gaps allowed", "Not an automatic purchase or dispatch decision"],
            "series_used": series[-10:]}
