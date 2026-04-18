import os
import logging
from typing import List, Optional

import pandas as pd


logger = logging.getLogger("ingestion")


def _coerce_numeric(series):
    return (
        series.dropna()
        .astype(float)
        .tolist()
    )


def load_demand_series(
    source_path: Optional[str] = None,
    n_months: int = 12,
    value_column_candidates: Optional[List[str]] = None,
    date_column_candidates: Optional[List[str]] = None,
) -> List[float]:
    """
    Load a numeric time-series for demand/shipments from CSV.

    Priority:
    1) `source_path` parameter
    2) ENV WHO_MI4A_CSV
    3) ENV UNICEF_SHIPMENTS_CSV
    Falls back to a small seeded series (not random) so the API remains usable in dev.
    """
    value_column_candidates = value_column_candidates or [
        "doses",
        "quantity",
        "volume",
        "shipments",
        "demand",
        "value",
    ]
    date_column_candidates = date_column_candidates or ["date", "month", "timestamp"]

    path = (
        source_path
        or os.getenv("WHO_MI4A_CSV")
        or os.getenv("UNICEF_SHIPMENTS_CSV")
    )

    if path and os.path.exists(path):
        df = pd.read_csv(path)

        date_col = next((c for c in date_column_candidates if c in df.columns), None)
        if date_col:
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
            df = df.sort_values(date_col)

        value_col = next((c for c in value_column_candidates if c in df.columns), None)
        if not value_col:
            raise ValueError(
                f"Could not find numeric column in {path}. "
                f"Available columns: {df.columns.tolist()}"
            )

        series = _coerce_numeric(df[value_col])
        if n_months:
            series = series[-n_months:]

        logger.info("Loaded %s points from %s", len(series), path)
        return series

    logger.warning(
        "No real CSV found (checked source_path + WHO_MI4A_CSV + UNICEF_SHIPMENTS_CSV). "
        "Using deterministic seeded series for development."
    )
    # Deterministic small series to keep API alive in dev; replace with real CSV in prod.
    seeded = [12000, 14000, 15000, 16000, 18000, 17500, 19000, 21000, 22500, 24000, 24500, 26000]
    return seeded[-n_months:]
