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
  expect(screen.getByText(/All device timestamps use a synthetic simulation clock/)).toBeInTheDocument();
  await screen.findByRole("option", { name: "B (demo)" });
  expect(screen.getByLabelText("Tick interval (milliseconds)")).toHaveValue(5000);
  expect(screen.getByLabelText("Generator minimum (°C)")).toHaveValue(null);
  for (const [label, value] of [["Device ID", "IOT-1"], ["Generator minimum (°C)", "2"], ["Generator maximum (°C)", "8"]])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.change(screen.getByLabelText("Simulator batch"), { target: { value: "B" } });
  expect(screen.getByText(/no approved cold-chain policy/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create virtual device" }));
  await waitFor(() => expect(api.createVirtualDevice).toHaveBeenCalledWith(expect.objectContaining({ deviceId: "IOT-1", batchId: "B", seed: "1", tickIntervalMs: 5000, temperatureRange: { min: 2, max: 8 } })));
  const configuredStart = Date.parse(api.createVirtualDevice.mock.calls[0][0].startTime);
  expect(configuredStart).toBeGreaterThan(Date.now() - 60 * 1000);
  expect(configuredStart).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
});

test("labels the device timestamp as the next simulated reading", async () => {
  api.fetchSimulatorStatuses.mockResolvedValue({ simulations: [{ deviceId: "IOT-1", scenario: "NORMAL", nextTimestamp: "2026-01-01T00:05:00.000Z", ticksGenerated: 1 }] });
  render(<SimulatorPanel />);
  const readingLabel = await screen.findByText(/Next simulated reading:/);
  expect(readingLabel.closest("p")).toHaveTextContent("2026-01-01T00:05:00.000Z");
});
test("exposes lifecycle controls and saved retry error", async () => {
  api.fetchSimulatorStatuses.mockResolvedValue({ simulations: [{ deviceId: "IOT-1", scenario: "NORMAL", pendingRetry: true, lastError: "Saved outage", ticksGenerated: 1 }] });
  render(<SimulatorPanel />);
  await screen.findByText(/Saved outage/);
  fireEvent.click(screen.getByRole("button", { name: "Tick once" }));
  await waitFor(() => expect(api.tickSimulation).toHaveBeenCalledWith("IOT-1"));
  expect(screen.getByLabelText("Scenario for IOT-1")).toBeDisabled();
});

test("all lifecycle, scenario and monitoring controls call their matching endpoints", async () => {
  api.fetchSimulatorStatuses.mockResolvedValue({ simulations: [{ deviceId: "IOT-1", scenario: "NORMAL", running: true, ticksGenerated: 2 }] });
  render(<SimulatorPanel />);
  await screen.findByRole("button", { name: "Stop" });
  expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(api.stopSimulation).toHaveBeenCalledWith("IOT-1"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Reset" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(api.resetSimulation).toHaveBeenCalledWith("IOT-1"));
  await waitFor(() => expect(screen.getByLabelText("Scenario for IOT-1")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Scenario for IOT-1"), { target: { value: "HIGH_TEMPERATURE" } });
  await waitFor(() => expect(api.changeSimulationScenario).toHaveBeenCalledWith("IOT-1", "HIGH_TEMPERATURE"));
  await waitFor(() => expect(screen.getByLabelText("Arm automatic silence monitoring")).not.toBeDisabled());
  fireEvent.click(screen.getByLabelText("Arm automatic silence monitoring"));
  await waitFor(() => expect(api.setSimulationMonitoring).toHaveBeenCalledWith("IOT-1", true));
});

test("prevents repeated ticks while one save is pending", async () => {
  api.fetchSimulatorStatuses.mockResolvedValue({ simulations: [{ deviceId: "IOT-1", scenario: "NORMAL", ticksGenerated: 0 }] });
  api.tickSimulation.mockReturnValue(new Promise(() => {}));
  render(<SimulatorPanel />);
  const tick = await screen.findByRole("button", { name: "Tick once" });
  fireEvent.click(tick); fireEvent.click(tick);
  expect(api.tickSimulation).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
});

test("rejects invalid route and temperature bounds without sending a create request", async () => {
  render(<SimulatorPanel />);
  await screen.findByRole("option", { name: "B (demo)" });
  for (const [label, value] of [["Device ID", "IOT-2"], ["Generator minimum (°C)", "8"], ["Generator maximum (°C)", "2"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.change(screen.getByLabelText("Simulator batch"), { target: { value: "B" } });
  fireEvent.click(screen.getByRole("button", { name: "Create virtual device" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("minimum must be below maximum");
  fireEvent.change(screen.getByLabelText("Generator maximum (°C)"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Optional GPS route (JSON)"), { target: { value: "not-json" } });
  fireEvent.click(screen.getByRole("button", { name: "Create virtual device" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("GPS route must be valid JSON");
  expect(api.createVirtualDevice).not.toHaveBeenCalled();
});

test("successful refresh clears a previous connection error", async () => {
  api.fetchSimulatorInputs.mockRejectedValueOnce(new Error("Offline"));
  render(<SimulatorPanel />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Refresh devices" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

test("starts a stopped device and shows server failures without changing saved status", async () => {
  api.fetchSimulatorStatuses.mockResolvedValue({ simulations: [{ deviceId: "IOT-1", scenario: "NORMAL", running: false, ticksGenerated: 0 }] });
  api.startSimulation.mockRejectedValueOnce({ response: { data: { error: "Device is blocked until its pending reading is saved" } } });
  render(<SimulatorPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Start" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("pending reading");
  expect(api.startSimulation).toHaveBeenCalledWith("IOT-1");
  expect(screen.getByText("IOT-1 — Stopped")).toBeInTheDocument();
});
