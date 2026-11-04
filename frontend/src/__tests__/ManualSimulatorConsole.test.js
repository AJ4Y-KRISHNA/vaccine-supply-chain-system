import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ManualSimulatorConsole from "../pages/ManualSimulatorConsole";
import * as simulator from "../services/simulator";
import { fetchColdChainPolicy, fetchTemperatureAlerts } from "../services/alerts";

jest.mock("../services/simulator", () => ({
  fetchSimulatorInputs: jest.fn(), fetchSimulatorStatuses: jest.fn(), fetchManualSimulatorPresets: jest.fn(),
  fetchManualSimulatorOverrides: jest.fn(), createManualSimulatorOverride: jest.fn(), updateManualSimulatorOverride: jest.fn(),
  releaseManualSimulatorOverride: jest.fn(), tickSimulation: jest.fn(),
}));
jest.mock("../services/alerts", () => ({ fetchTemperatureAlerts: jest.fn(), fetchColdChainPolicy: jest.fn() }));

const options = { batches: [{ batchId: "B-1", vaccineType: "Demo vaccine" }], shipments: [{ shipmentId: "S-1", batchId: "B-1" }] };
const device = { deviceId: "D-1", shipmentId: "S-1", running: false, nextTimestamp: "2026-01-01T00:02:00.000Z", lastReading: {
  timestamp: "2026-01-01T00:01:00.000Z", temperature: 5, humidity: 50, batteryLevel: 98,
  source: "auto-simulated", location: { lat: 9.9, lng: 76.2 },
} };
const presetList = [{ id: "refrigeration-failure", name: "Refrigeration failure", description: "Synthetic warming.", targetTemperature: 12, behavior: "ramp", rampDuration: 2, holdDuration: 10 }];
const policy = {
  minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 30, maximumHumidity: 70,
  sourceReference: "Demo policy", excursionDurationMs: 120000,
};

beforeEach(() => {
  jest.clearAllMocks();
  simulator.fetchSimulatorInputs.mockResolvedValue(options);
  simulator.fetchSimulatorStatuses.mockResolvedValue({ simulations: [device] });
  simulator.fetchManualSimulatorPresets.mockResolvedValue({ presets: presetList, expiry: { default: 1800000, max: 86400000 } });
  simulator.fetchManualSimulatorOverrides.mockResolvedValue({ overrides: [] });
  simulator.createManualSimulatorOverride.mockResolvedValue({ message: "Manual simulator override created" });
  simulator.updateManualSimulatorOverride.mockResolvedValue({ message: "Manual simulator override updated" });
  simulator.releaseManualSimulatorOverride.mockResolvedValue({ message: "Simulator returned to automatic mode" });
  simulator.tickSimulation.mockResolvedValue({ message: "Simulation tick persisted" });
  fetchTemperatureAlerts.mockResolvedValue({ alerts: [] });
  fetchColdChainPolicy.mockResolvedValue({ batchId: "B-1", policyStatus: "APPROVED", policy });
});

function renderConsole(props = {}, initialEntry = "/admin/manual-simulator") {
  return render(<MemoryRouter initialEntries={[initialEntry]}><ManualSimulatorConsole enabled {...props} /></MemoryRouter>);
}

test("keeps the entire console hidden while its frontend feature flag is off", () => {
  const { container } = render(<MemoryRouter><ManualSimulatorConsole enabled={false} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
  expect(simulator.fetchSimulatorInputs).not.toHaveBeenCalled();
});

test("resolves shipment context and shows live reading, approved limits, alerts and source", async () => {
  renderConsole();
  expect(await screen.findByText(/B-1 · Demo vaccine/)).toBeInTheDocument();
  expect(await screen.findByText("2°C to 8°C")).toBeInTheDocument();
  expect(await screen.findByText("5°C")).toBeInTheDocument();
  expect(await screen.findByText("Automatic simulator")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Temperature policy band: 2 to 8/ })).toBeInTheDocument();
  expect(screen.getByText(/No policy alerts are recorded/)).toBeInTheDocument();
  expect(simulator.fetchManualSimulatorOverrides).toHaveBeenCalledWith({ shipmentId: "S-1", status: "ALL", limit: 50 });
  expect(fetchTemperatureAlerts).toHaveBeenCalledWith({ batchId: "B-1", limit: 20 });
  expect(fetchColdChainPolicy).toHaveBeenCalledWith("B-1");
});

test("submits a valid custom target through the override API and generates a policy-backed reading", async () => {
  renderConsole();
  await screen.findByText("Automatic simulator");
  fireEvent.change(screen.getByLabelText("Temperature target"), { target: { value: "6.5" } });
  fireEvent.change(screen.getByLabelText("Override reason"), { target: { value: "Classroom test run" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply override" }));
  await waitFor(() => expect(simulator.createManualSimulatorOverride).toHaveBeenCalledWith(expect.objectContaining({
    shipmentId: "S-1", targetTemperature: 6.5, behavior: "hold", holdDuration: 10,
    expiresInMs: 1800000, reason: "Classroom test run",
  })));
  fireEvent.click(screen.getByRole("button", { name: "Generate one reading" }));
  await waitFor(() => expect(simulator.tickSimulation).toHaveBeenCalledWith("D-1"));
});

test("requires explicit confirmation before applying a target outside approved policy limits", async () => {
  renderConsole();
  await screen.findByText("Automatic simulator");
  fireEvent.change(screen.getByLabelText("Temperature target"), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply override" }));
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("outside the approved range");
  expect(simulator.createManualSimulatorOverride).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm apply synthetic override" }));
  await waitFor(() => expect(simulator.createManualSimulatorOverride).toHaveBeenCalledWith(expect.objectContaining({ targetTemperature: 12 })));
});

test("rejects physically invalid values and duration combinations before making a request", async () => {
  renderConsole();
  await screen.findByText("Automatic simulator");
  fireEvent.change(screen.getByLabelText("Temperature target"), { target: { value: "61" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply override" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("between -40 and 60°C");
  expect(simulator.createManualSimulatorOverride).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Temperature target"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("Ramp duration"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("Override behavior"), { target: { value: "ramp" } });
  fireEvent.change(screen.getByLabelText("Hold duration"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("Override expiry minutes"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply override" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Expiry must cover");
  expect(simulator.createManualSimulatorOverride).not.toHaveBeenCalled();
});

test("selects a preset, modifies the active override, and returns it to automatic mode", async () => {
  simulator.fetchManualSimulatorOverrides.mockResolvedValue({ overrides: [{ overrideId: "OVR-1", shipmentId: "S-1", status: "ACTIVE", mode: "manual", expiresAt: "2026-01-01T00:30:00.000Z", effectiveAt: "2026-01-01T00:00:00.000Z", rampDuration: 2, holdDuration: 10, presetId: "refrigeration-failure", reason: "Existing synthetic scenario" }] });
  renderConsole();
  expect(await screen.findByText("Active manual override")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Refrigeration failure/ }));
  fireEvent.click(screen.getByRole("button", { name: "Update override" }));
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Confirm apply synthetic override" }));
  await waitFor(() => expect(simulator.updateManualSimulatorOverride).toHaveBeenCalledWith("OVR-1", expect.objectContaining({ presetId: "refrigeration-failure", shipmentId: "S-1" })));
  await waitFor(() => expect(screen.getByRole("button", { name: "Return to automatic" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Return to automatic" }));
  await waitFor(() => expect(simulator.releaseManualSimulatorOverride).toHaveBeenCalledWith("OVR-1", expect.objectContaining({ reason: expect.stringContaining("automatic simulation") })));
});

test("deep-linked shipment IDs are selected for a guided demonstration", async () => {
  renderConsole({}, "/admin/manual-simulator?shipmentId=S-1");
  expect(await screen.findByLabelText("Controlled shipment")).toHaveValue("S-1");
});
