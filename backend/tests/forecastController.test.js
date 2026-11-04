jest.mock("../models/Order", () => ({ aggregate: jest.fn() }));
jest.mock("../services/aiService", () => ({ getForecast: jest.fn() }));

const Order = require("../models/Order");
const { getForecast } = require("../services/aiService");
const { getForecast: handleForecast, loadOrderDemandSeries } = require("../controllers/forecastController");

function monthsEndingBefore(now, count) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - count + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

describe("order-history demand forecasts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("aggregates authenticated-scope persisted orders into a single product's chronological monthly series", async () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    const labels = monthsEndingBefore(now, 6);
    Order.aggregate.mockResolvedValue(labels.map((month, index) => ({
      _id: { vaccineType: "Vaccine A", month }, demandDoses: 100 + index * 10, orderCount: index + 1,
    })));

    const loaded = await loadOrderDemandSeries({ scope: { order: { hospital: "clinic-a" } }, months: 6, now });

    expect(loaded.series).toEqual([100, 110, 120, 130, 140, 150]);
    expect(loaded.provenance).toMatchObject({ source: "MongoDB persisted Order records", synthetic: false,
      period: "month", vaccine_type: "Vaccine A", observed_order_months: 6, order_count: 21 });
    expect(Order.aggregate.mock.calls[0][0][0].$match.$and[0]).toEqual({ hospital: "clinic-a" });
    expect(Order.aggregate.mock.calls[0][0][0].$match.$and[2].status.$nin).toContain("Rejected");
  });

  test("does not invent demand when fewer than six observed order months exist", async () => {
    Order.aggregate.mockResolvedValue([
      { _id: { vaccineType: "Vaccine A", month: "2026-08" }, demandDoses: 100, orderCount: 1 },
      { _id: { vaccineType: "Vaccine A", month: "2026-09" }, demandDoses: 150, orderCount: 1 },
    ]);
    await expect(loadOrderDemandSeries({ months: 12 })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("2 month(s) are available") });
  });

  test("returns multi-period forecast output and provenance from persisted orders", async () => {
    const now = new Date();
    const labels = monthsEndingBefore(now, 6);
    Order.aggregate.mockResolvedValue(labels.map((month, index) => ({
      _id: { vaccineType: "Vaccine B", month }, demandDoses: 80 + index * 5, orderCount: 2,
    })));
    const forecast = { model: "holt_linear", predicted_demand: 110, horizon: 3,
      forecast_periods: [{ period: "2026-10", demand_doses: 110 }, { period: "2026-11", demand_doses: 115 }, { period: "2026-12", demand_doses: 120 }] };
    getForecast.mockResolvedValue(forecast);
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await handleForecast({ body: { months: 6, horizon: 3 }, scope: { order: { hospital: "clinic-a" } } }, response);

    expect(getForecast).toHaveBeenCalledWith(expect.objectContaining({
      vaccination_data: [80, 85, 90, 95, 100, 105], horizon: 3,
      provenance: expect.objectContaining({ source: "MongoDB persisted Order records", vaccine_type: "Vaccine B", synthetic: false }),
    }));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ forecast }));
  });
});
