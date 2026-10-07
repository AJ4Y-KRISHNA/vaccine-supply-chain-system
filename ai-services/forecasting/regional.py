"""Bounded SARIMA comparison on synthetic monthly orders; not clinical evidence."""
import math
import warnings
from datetime import date
import numpy as np
import scipy
import statsmodels
from statsmodels.tsa.statespace.sarimax import SARIMAX


def metrics(actual, predicted):
    errors = np.asarray(actual, dtype=float) - np.asarray(predicted, dtype=float)
    nonzero = np.asarray(actual) != 0
    return {"rmse": float(np.sqrt(np.mean(errors ** 2))),
            "mape": float(np.mean(np.abs(errors[nonzero] / np.asarray(actual)[nonzero])) * 100) if nonzero.any() else None,
            "mape_excluded_zero_months": int((~nonzero).sum()), "test_months": len(actual)}


def seasonal(values, horizon):
    return [float(values[-12 + (i % 12)]) for i in range(horizon)]


def fit_sarima(values):
    # A fixed, low-order specification avoids an unbounded hyperparameter search.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = SARIMAX(values, order=(1, 0, 0), seasonal_order=(0, 1, 1, 12),
                        enforce_stationarity=False, enforce_invertibility=False)
        fit = model.fit(disp=False, maxiter=100)
        if not fit.mle_retvals.get("converged", False):
            # Exactly repeating synthetic fixtures can have near-zero residual variance.
            fit = model.fit(disp=False, maxiter=300, method="powell")
    if not fit.mle_retvals.get("converged", False):
        raise ValueError("SARIMA fit did not converge")
    return fit


def forecast_regional(values, horizon, last_period):
    if horizon not in (3, 4, 5, 6):
        raise ValueError("horizon must be 3–6 months")
    if not 30 <= len(values) <= 120 or any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) or v < 0 or v > 1e9 for v in values):
        raise ValueError("Provide 30–120 complete, chronological monthly observations")
    year, month = map(int, last_period.split("-"))
    date(year, month, 1)
    values = list(map(float, values))
    train, actual = values[:-6], values[-6:]
    baseline_metrics = metrics(actual, seasonal(train, 6))
    comparisons = [{"model": "seasonal_naive_12", "status": "evaluated", **baseline_metrics}]
    selected, fitted = "seasonal_naive_12", None
    try:
        candidate = fit_sarima(train)
        predicted = np.maximum(0, np.asarray(candidate.forecast(6)))
        if not np.isfinite(predicted).all():
            raise ValueError("Non-finite SARIMA forecast")
        evaluated = metrics(actual, predicted)
        comparisons.append({"model": "SARIMA(1,0,0)(0,1,1,12)", "status": "evaluated", **evaluated})
        if evaluated["rmse"] < baseline_metrics["rmse"]:
            fitted = fit_sarima(values)
            selected = "SARIMA(1,0,0)(0,1,1,12)"
    except (ValueError, RuntimeError, np.linalg.LinAlgError) as error:
        comparisons.append({"model": "SARIMA(1,0,0)(0,1,1,12)", "status": "unavailable", "reason": str(error)[:160]})
    if fitted is not None:
        result = fitted.get_forecast(horizon)
        predicted = np.maximum(0, np.asarray(result.predicted_mean))
        intervals = np.maximum(0, np.asarray(result.conf_int(alpha=0.05)))
        interval_method = "SARIMA model-based 95% prediction interval"
    else:
        predicted = seasonal(values, horizon)
        residuals = np.array(values[12:]) - np.array(values[:-12])
        spread = 1.96 * float(np.sqrt(np.mean(residuals ** 2)))
        intervals = [[max(0, p - spread), p + spread] for p in predicted]
        interval_method = "Approximate 95% prediction interval: seasonal residual RMS × 1.96 (normal-error assumption)"
    if not np.isfinite(np.asarray(intervals)).all():
        raise ValueError("Non-finite forecast interval")
    periods = []
    for i, (p, bounds) in enumerate(zip(predicted, intervals), 1):
        offset = year * 12 + month - 1 + i
        periods.append({"period": f"{offset // 12:04d}-{offset % 12 + 1:02d}",
                        "demand_doses": int(math.ceil(p)), "lower": int(math.floor(min(bounds[0], p))),
                        "upper": int(math.ceil(max(bounds[1], p)))})
    return {"synthetic": True, "advisory_only": True, "model": selected, "forecast_periods": periods,
            "library_versions": {"numpy": np.__version__, "scipy": scipy.__version__, "statsmodels": statsmodels.__version__},
            "comparison": comparisons, "selection_metric": "six-month holdout RMSE",
            "training_months": len(train), "refit_months": len(values), "history": values,
            "interval_method": interval_method, "confidence_level": 0.95,
            "limitations": ["Single six-month holdout; selection and reported metrics use the same holdout, not independent external validation.",
                            "Synthetic orders only; intervals are model assumptions, not guarantees or clinical evidence.",
                            "No stock changes or dispatch are performed by forecasting."]}
