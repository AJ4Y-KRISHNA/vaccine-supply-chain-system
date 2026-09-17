import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SimulatorPanel from "../components/SimulatorPanel";
import * as api from "../services/simulator";
jest.mock("../services/simulator", () => ({ fetchSimulatorInputs: jest.fn(), fetchSimulatorStatuses: jest.fn(), createVirtualDevice: jest.fn(),
  startSimulation: jest.fn(), stopSimulation: jest.fn(), tickSimulation: jest.fn(), resetSimulation: jest.fn(), changeSimulationScenario: jest.fn(), setSimulationMonitoring: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  api.fetchSimulatorInputs.mockResolvedValue({ batches: [{ batchId: "B", isDemo: true }], shipments: [{ shipmentId: "S", batchId: "B" }], scenarios: ["NORMAL", "HIGH_TEMPERATURE"] });
  api.fetchSimulatorStatuses.mockResolvedValue({ simulations: [] });
});
test("creates a device with explicit generator settings, seed, simulation clock and real batch", async () => {
  render(<SimulatorPanel />);
  await screen.findByRole("option", { name: "B (demo)" });
  expect(screen.getByLabelText("Generator minimum (°C)")).toHaveValue(null);
  for (const [label, value] of [["Device ID", "IOT-1"], ["Generator minimum (°C)", "2"], ["Generator maximum (°C)", "8"]])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.change(screen.getByLabelText("Simulator batch"), { target: { value: "B" } });
  expect(screen.getByText(/no approved cold-chain policy/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create virtual device" }));
  await waitFor(() => expect(api.createVirtualDevice).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "IOT-1", batchId: "B", seed: "1", startTime: "2026-01-01T00:00:00.000Z", temperatureRange: { min: 2, max: 8 } })));
});
test("exposes lifecycle controls and saved retry error", async () => {
  api.fetchSimulatorStatuses.mockResolvedValue({ simulations: [{ deviceId: "IOT-1", scenario: "NORMAL", pendingRetry: true, lastError: "Saved outage", ticksGenerated: 1 }] });
  render(<SimulatorPanel />);
  await screen.findByText(/Saved outage/);
  fireEvent.click(screen.getByRole("button", { name: "Tick once" }));
  await waitFor(() => expect(api.tickSimulation).toHaveBeenCalledWith("IOT-1"));
  expect(screen.getByLabelText("Scenario for IOT-1")).toBeDisabled();
});
