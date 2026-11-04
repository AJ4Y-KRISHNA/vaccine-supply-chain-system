const { buildForecastSupplyContext } = require("../services/forecastSupplyContext");

test("forecast supply context separates eligible stock from active quarantine holds", () => {
  const inventory = [
    { batchId: "AVAILABLE-A", vaccineType: "Demo A", remainingDoses: 80, eligible: true, reasons: [] },
    { batchId: "HELD-A", vaccineType: "Demo A", remainingDoses: 20, eligible: false, reasons: ["COLD_CHAIN_HOLD"] },
    { batchId: "DRAFT-A", vaccineType: "Demo A", remainingDoses: 50, eligible: false, reasons: ["BATCH_NOT_RELEASED"] },
    { batchId: "AVAILABLE-B", vaccineType: "Demo B", remainingDoses: 900, eligible: true, reasons: [] },
    { batchId: "AMBIGUOUS-A", vaccineType: "Demo A", remainingDoses: 15, eligible: false, reasons: ["AMBIGUOUS_BATCH_ID"] },
    { batchId: "AMBIGUOUS-A", vaccineType: "Demo A", remainingDoses: 15, eligible: false, reasons: ["AMBIGUOUS_BATCH_ID"] },
  ];
  const context = buildForecastSupplyContext({
    inventory,
    vaccineType: "Demo A",
    capturedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(context).toMatchObject({
    status: "available",
    scope: "single vaccine type",
    vaccine_type: "Demo A",
    total_unallocated_stock_doses: 150,
    current_available_stock_doses: 80,
    active_quarantine_batch_count: 1,
    quarantined_unallocated_doses: 20,
    unavailable_unallocated_stock_doses: 70,
    captured_at: "2026-01-01T00:00:00.000Z",
  });
});
