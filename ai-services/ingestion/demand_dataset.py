"""Explicit provenance and conservative local CSV loading; never silent real-data fallback."""
import csv
import hashlib
import io
import os
from pathlib import Path
from forecasting.baselines import validate

def load_dataset(source_path=None, n_months=12):
    if not isinstance(n_months, int) or not 6 <= n_months <= 240:
        raise ValueError("months must be between 6 and 240")
    configured = [Path(p).resolve() for p in [os.getenv("WHO_MI4A_CSV"), os.getenv("UNICEF_SHIPMENTS_CSV")] if p]
    if source_path and Path(source_path).resolve() not in configured:
        raise ValueError("CSV access is restricted to operator-configured dataset paths")
    path = Path(source_path).resolve() if source_path else (configured[0] if configured else None)
    if path:
        if not path.is_file() or path.stat().st_size > 5_000_000:
            raise ValueError("Configured CSV is missing or exceeds 5 MB; no synthetic fallback used")
        content = path.read_bytes()
        rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
        # Deliberately strict canonical schema: aggregate one product/region upstream.
        if not rows or not {"month", "doses"}.issubset(rows[0]):
            raise ValueError("CSV requires month (YYYY-MM) and doses; one pre-aggregated product/region")
        periods, values = [], []
        for row in rows:
            year, month = map(int, row["month"].split("-"))
            if not 1 <= month <= 12 or not 1900 <= year <= 2200: raise ValueError("Invalid month")
            periods.append(year * 12 + month)
            values.append(float(row["doses"]))
        if any(b - a != 1 for a, b in zip(periods, periods[1:])):
            raise ValueError("CSV months must be chronological, unique and contiguous")
        values = validate(values[-n_months:])
        return values, {"source": path.name, "sha256": hashlib.sha256(content).hexdigest(),
                        "synthetic": False, "verification": "operator-supplied, not independently verified", "period": "month"}
    values = [12000, 14000, 15000, 16000, 18000, 17500, 19000, 21000, 22500, 24000, 24500, 26000][-n_months:]
    return values, {"source": "built-in deterministic demo fixture v1", "synthetic": True, "period": "month", "verification": "NOT observed vaccine demand"}
