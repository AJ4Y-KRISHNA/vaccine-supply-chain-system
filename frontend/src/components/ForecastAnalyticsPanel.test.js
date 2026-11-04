import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import API from "../services/api";
import Panel from "./ForecastAnalyticsPanel";
jest.mock("../services/api", () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock("react-chartjs-2", () => ({ Line: ({ data }) => <div data-testid="forecast-chart">{data.labels.join(",")}</div> }));
const forecast = { model: "seasonal_naive_12", history: [100], history_periods: ["2026-09"],
  provenance: { observation_count: 35, vaccine_type: "A", region: "R", note: "Complete months only" },
  forecast_periods: [{ period: "2026-10", demand_doses: 120, lower: 90, upper: 150 }],
  comparison: [{ model: "seasonal_naive_12", rmse: 10, mape: 5, status: "evaluated" }], limitations: [], interval_method: "95% prediction interval" };
beforeEach(() => { jest.clearAllMocks(); API.get.mockImplementation(url => Promise.resolve({ data: url === "/forecast" ? {
  catalog: [{ vaccineType: "A", region: "R", months: 35, ready: true }] } : {} })); });
async function generate(role) {
  render(<Panel role={role} />); await screen.findByText("A — R (35 months)");
  API.get.mockResolvedValueOnce({ data: { forecast, runId: "run-1" } });
  fireEvent.click(screen.getByText("Generate forecast")); await screen.findByTestId("forecast-chart");
}
test("manufacturer sees persisted provenance, chart and metrics but no approval controls", async () => {
  await generate("manufacturer");
  expect(screen.getByText(/synthetic history, 35 months/)).toBeTruthy();
  expect(screen.getByText("10.00")).toBeTruthy();
  expect(screen.queryByText("Compute recommendation")).toBeNull();
});
test("admin enters capacity, computes a plan and explicitly approves without stock changes", async () => {
  await generate("admin");
  API.post.mockResolvedValueOnce({ data: { planId: "p1", allocatedDoses: 0, method: "greedy_fallback", allocations: [], unfilled: [], exclusions: [], assumptions: ["No auto-dispatch"] } });
  fireEvent.change(screen.getByLabelText("Region capacity"), { target: { value: "300" } });
  fireEvent.click(screen.getByText("Compute recommendation")); await screen.findByText("No auto-dispatch");
  expect(API.post).toHaveBeenCalledWith("/admin/forecast-plan", expect.objectContaining({ destinationCapacity: 300, runIds: ["run-1"] }));
  fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Synthetic human review completed" } });
  API.post.mockResolvedValueOnce({ data: { stockChanged: false, dispatched: false } });
  fireEvent.click(screen.getByText("Approve recommendation for review record"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Stock unchanged"));
});
test("failed history request can be retried without fabricated data", async () => {
  API.get.mockRejectedValueOnce(new Error("Unavailable"));
  render(<Panel role="manufacturer" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Forecast history unavailable");
  fireEvent.click(screen.getByText("Refresh forecast history"));
  await screen.findByText("A — R (35 months)");
  expect(screen.queryByRole("alert")).toBeNull();
});
test("metrics download uses the account-scoped endpoint and a synthetic JSON filename", async () => {
  await generate("manufacturer");
  URL.createObjectURL = jest.fn(() => "blob:synthetic-test"); URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  API.get.mockResolvedValueOnce({ data: { synthetic: true, comparison: [] } });
  fireEvent.click(screen.getByText("Download thesis metrics JSON"));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(API.get).toHaveBeenLastCalledWith("/forecast/run-1/metrics");
  expect(click.mock.instances[0].download).toBe("synthetic-forecast-run-1.json");
  click.mockRestore();
});
