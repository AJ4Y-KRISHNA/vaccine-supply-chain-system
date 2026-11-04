import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ManufacturerDashboard from "../pages/ManufacturerDashboard";
jest.mock("../components/ForecastAnalyticsPanel", () => () => <div>Regional analytics panel</div>);
import { fetchManufacturerDashboard, signManufacturerBatchRelease } from "../services/dashboard";
import { createManufacturerBatch } from "../services/workflow";
jest.mock("../services/dashboard", () => ({ fetchManufacturerDashboard: jest.fn(), signManufacturerBatchRelease: jest.fn() }));
jest.mock("../services/workflow", () => ({ createManufacturerBatch: jest.fn() }));
jest.mock("../components/Toast", () => ({ useToast: () => ({ addToast: mockToast }) }));
jest.mock("../components/TraceabilityPanel", () => () => <div>Shipment journey panel</div>);
jest.mock("react-chartjs-2", () => ({ Line: () => <div>Distribution chart</div> }));
jest.mock("../components/BlockchainLog", () => () => null);
jest.mock("../components/TemperatureAlertPanel", () => () => null);
jest.mock("../components/SimulatorPanel", () => () => null);
const mockToast = jest.fn();
beforeEach(() => { jest.resetAllMocks(); });

test("sidebar opens the real form and a successful creation refreshes the batch table", async () => {
  const snapshot = { identity: { manufacturer: "Demo Maker" }, cards: {}, batches: [] };
  const batch = { batchId: "CLASS-FRESH", vaccineType: "Fresh synthetic product", quantity: 100, expiresAt: "2099-12-31T00:00:00.000Z", manufacturer: "Demo Maker" };
  fetchManufacturerDashboard.mockResolvedValueOnce(snapshot).mockResolvedValue({ ...snapshot, batches: [batch] });
  createManufacturerBatch.mockResolvedValue({ batch });
  render(<MemoryRouter><ManufacturerDashboard /></MemoryRouter>);
  await waitFor(() => expect(fetchManufacturerDashboard).toHaveBeenCalledTimes(1));
  const menu = screen.getByRole("button", { name: "Create New Batch" });
  expect(menu).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(menu);
  expect(menu).toHaveAttribute("aria-expanded", "true");
  for (const [name, value] of [["Batch ID", batch.batchId], ["Vaccine type / product", batch.vaccineType], ["Batch quantity (doses)", "100"],
    ["Supplier", "Class supplier"], ["Material type", "Class material"], ["Material quantity (whole units)", "100"], ["Expiry date (UTC)", "2099-12-31"]])
    fireEvent.change(screen.getByLabelText(`${name} *`), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Create batch and report" }));
  await screen.findByText(`Batch ${batch.batchId} created successfully.`);
  await waitFor(() => expect(fetchManufacturerDashboard).toHaveBeenCalledTimes(2));
  const table = screen.getAllByRole("table")[0];
  expect(within(table).getByText(batch.batchId)).toBeInTheDocument();
  expect(within(table).getByText("Expiry (UTC): 2099-12-31")).toBeInTheDocument();
  expect(within(table).getByRole("button", { name: "Production Sign" })).toBeInTheDocument();
  expect(within(table).getByRole("button", { name: "Lab Sign" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("region", { name: "Create New Batch" })).not.toBeInTheDocument();
});

test("a saved sign-off with a failed refresh is not reported as a failed sign-off", async () => {
  const batch = { batchId: "SIGN-1", vaccineType: "Synthetic", quantity: 1 };
  fetchManufacturerDashboard.mockResolvedValueOnce({ cards: {}, batches: [batch] }).mockRejectedValue(new Error("Offline"));
  signManufacturerBatchRelease.mockResolvedValue({});
  render(<MemoryRouter><ManufacturerDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Production Sign" }));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("success", "Production sign-off saved"));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("error", expect.stringContaining("Sign-off was saved, but the dashboard could not refresh")));
  expect(screen.getByRole("button", { name: "Production Sign" })).toBeDisabled();
  expect(signManufacturerBatchRelease).toHaveBeenCalledTimes(1);
});
