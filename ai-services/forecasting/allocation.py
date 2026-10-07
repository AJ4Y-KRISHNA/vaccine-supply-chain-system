"""Whole-dose projection of a continuous LP, with a deterministic greedy fallback."""
import math
from scipy.optimize import linprog


def optimize(inventory, demand, capacity):
    def count(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value != int(value) or value > 10000000:
            raise ValueError("Dose counts and capacity must be bounded nonnegative integers")
        return int(value)
    capacity = count(capacity)
    stocks = [count(row["remainingDoses"]) for row in inventory]
    needs = [count(row["doses"]) for row in demand]
    limits = [min(n, count(row["capacity"])) for n, row in zip(needs, demand)]
    # Caller supplies eligible stock already filtered by expiry and policy holds.
    edges = [(i, j) for i, batch in enumerate(inventory) for j, target in enumerate(demand)
             if batch["vaccineType"] == target["vaccineType"]]
    allocations = [0] * len(edges)
    regions = sorted(set(row["region"] for row in demand))
    region_limits = {region: min(count(row["capacity"]) for row in demand if row["region"] == region) for region in regions}
    method = "greedy_fallback"
    fallback_reason = None
    if edges:
        rows = [[int(edge[0] == i) for edge in edges] for i in range(len(stocks))]
        rows += [[int(edge[1] == j) for edge in edges] for j in range(len(needs))]
        rows += [[int(demand[j]["region"] == region) for _, j in edges] for region in regions]
        rows += [[1] * len(edges)]
        try:
            result = linprog([-1.0] * len(edges), A_ub=rows, b_ub=stocks + limits + list(region_limits.values()) + [capacity], bounds=(0, None), method="highs")
            if result.success and all(math.isfinite(x) for x in result.x):
                allocations = [max(0, int(math.floor(x + 1e-7))) for x in result.x]
                method = "scipy_linprog_highs_whole_dose_projection"
            else:
                fallback_reason = "LP did not return a finite feasible solution"
        except (ValueError, RuntimeError) as error:
            fallback_reason = str(error)[:160]
    # Check the projection; never trust solver rounding to exceed a hard constraint.
    used_stock = [sum(a for a, (i, _) in zip(allocations, edges) if i == k) for k in range(len(stocks))]
    used_demand = [sum(a for a, (_, j) in zip(allocations, edges) if j == k) for k in range(len(needs))]
    if any(a > b for a, b in zip(used_stock, stocks)) or any(a > b for a, b in zip(used_demand, limits)) or sum(allocations) > capacity or any(sum(a for a, (_, j) in zip(allocations, edges) if demand[j]["region"] == region) > region_limits[region] for region in regions):
        allocations = [0] * len(edges)
        method, fallback_reason = "greedy_fallback", "Projected LP violated a constraint"
    for index, (i, j) in enumerate(edges):
        used_i = sum(a for a, (s, _) in zip(allocations, edges) if s == i)
        used_j = sum(a for a, (_, t) in zip(allocations, edges) if t == j)
        used_region = sum(a for a, (_, t) in zip(allocations, edges) if demand[t]["region"] == demand[j]["region"])
        allocations[index] += min(stocks[i] - used_i, limits[j] - used_j, capacity - sum(allocations), region_limits[demand[j]["region"]] - used_region)
    plan = [{"batchId": inventory[i]["batchId"], "vaccineType": demand[j]["vaccineType"],
             "region": demand[j]["region"], "doses": a} for a, (i, j) in zip(allocations, edges) if a]
    return {"method": method, "fallback_reason": fallback_reason, "allocations": plan,
            "unfilled": [{"vaccineType": row["vaccineType"], "region": row["region"],
                          "doses": needs[j] - sum(a for a, (_, t) in zip(allocations, edges) if t == j)} for j, row in enumerate(demand)],
            "allocatedDoses": sum(allocations), "advisory_only": True,
            "assumptions": ["Maximize fulfilled doses, subject to product, eligible stock, destination and total transport capacity.",
                            "Continuous LP rounded to whole doses; deterministic residual/greedy pass, not a guaranteed integer or FEFO optimum.",
                            "Inputs are filtered for release, policy holds and expiry by the backend; no automatic dispatch or stock mutation."]}
