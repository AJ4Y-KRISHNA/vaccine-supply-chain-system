import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import GuidedDemoPanel from "../components/GuidedDemoPanel";
import ReviewerPermissionsPanel from "../components/ReviewerPermissionsPanel";
import SystemReadinessPanel from "../components/SystemReadinessPanel";
import TraceabilityPanel from "../components/TraceabilityPanel";
import { fetchAdminOrders } from "../services/workflow";
import { fetchManualSimulatorOverrides, fetchSimulatorStatuses } from "../services/simulator";
import { fetchTemperatureAlerts } from "../services/alerts";
import { fetchBatchJourney, fetchColdChainReviewers, fetchSystemReadiness, fetchTraceabilityBatches, setColdChainReviewer } from "../services/traceability";

jest.mock("react-chartjs-2", () => ({ Line: () => <div>Temperature chart</div> }));
jest.mock("../services/workflow", () => ({ fetchAdminOrders: jest.fn() }));
jest.mock("../services/simulator", () => ({ fetchManualSimulatorOverrides: jest.fn(), fetchSimulatorStatuses: jest.fn() }));
jest.mock("../services/alerts", () => ({ fetchTemperatureAlerts: jest.fn() }));
jest.mock("../services/traceability", () => ({ fetchBatchJourney: jest.fn(), fetchColdChainReviewers: jest.fn(), fetchSystemReadiness: jest.fn(), fetchTraceabilityBatches: jest.fn(), setColdChainReviewer: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear();
  fetchSystemReadiness.mockResolvedValue({ checkedAt: "2026-09-24T10:00:00.000Z", backend: { service: "backend API", status: "ready", reachable: true },
    database: { service: "MongoDB", status: "ready", reachable: true },
    mqtt: { service: "Mosquitto MQTT", status: "unavailable", reachable: false, healthy: false },
    redis: { service: "Redis", status: "unavailable", reachable: false, healthy: false },
    email: { service: "Ethereal demo email", status: "disabled", reachable: false, healthy: false, mode: "console", simulated: true },
    blockchain: { service: "local blockchain", status: "unreachable", reachable: false,
      contract: { addressConfigured: false, artifactAvailable: true, deployed: false, bytecodePresent: false, status: "not-configured" } } });
  fetchColdChainReviewers.mockResolvedValue({ reviewers: [{ userId: "u-1", email: "maker@example.test", role: "manufacturer", organization: "Maker A", canReviewColdChain: false, disabled: false }], audit: [] });
  setColdChainReviewer.mockResolvedValue({});
  fetchTraceabilityBatches.mockResolvedValue({ batches: [{ batchId: "BATCH-1", vaccineType: "Synthetic test" }] });
  fetchBatchJourney.mockResolvedValue({ batch: { batchId: "BATCH-1", vaccineType: "Synthetic test", quantity: 10, status: "Ready" }, policy: null, alerts: [],
    readings: [{ id: "r-1", recordedAt: "2026-01-01T00:00:00.000Z", temperature: 5, humidity: 55, batteryLevel: 90, latitude: 9, longitude: 76, deviceId: "sensor-1" }],
    events: [{ id: "batch-1", kind: "batch", title: "Vaccine batch created", at: "2026-01-01T00:00:00.000Z", role: "Manufacturer", actor: "Maker A", detail: "Synthetic test · 10 doses" },
      { id: "reading-1", kind: "telemetry", title: "Sensor reading recorded", at: "2026-01-01T00:00:00.000Z", role: "System", actor: "Virtual sensor sensor-1", deviceId: "sensor-1", detail: "5°C · 55% humidity" }] });
  fetchAdminOrders.mockResolvedValue({ orders: [] });
  fetchSimulatorStatuses.mockResolvedValue({ simulations: [] });
  fetchManualSimulatorOverrides.mockResolvedValue({ overrides: [] });
  fetchTemperatureAlerts.mockResolvedValue({ alerts: [] });
});

test("readiness panel shows service/contract status without configuration values", async () => {
  render(<SystemReadinessPanel />);
  expect(await screen.findByText("MongoDB")).toBeInTheDocument();
  expect(screen.getByText(/Contract status: Not configured/)).toBeInTheDocument();
  expect(screen.queryByText(/PRIVATE_KEY|0x[0-9a-f]{40}/i)).not.toBeInTheDocument();
});

test("reviewer permission changes require a reason and update via the admin API", async () => {
  fetchColdChainReviewers.mockResolvedValueOnce({ reviewers: [{ userId: "u-1", email: "maker@example.test", role: "manufacturer", canReviewColdChain: false }], audit: [] })
    .mockResolvedValueOnce({ reviewers: [{ userId: "u-1", email: "maker@example.test", role: "manufacturer", canReviewColdChain: true }], audit: [] });
  render(<ReviewerPermissionsPanel />);
  const grant = await screen.findByRole("button", { name: /Designate/ });
  fireEvent.click(grant);
  expect(await screen.findByRole("alert")).toHaveTextContent("reason of at least 3 characters");
  fireEvent.change(screen.getByLabelText("Reason for maker@example.test"), { target: { value: "Quality reviewer training completed" } });
  fireEvent.click(grant);
  await waitFor(() => expect(setColdChainReviewer).toHaveBeenCalledWith("u-1", { canReviewColdChain: true, reason: "Quality reviewer training completed" }));
  expect(await screen.findByText("Designated reviewer")).toBeInTheDocument();
});

test("journey panel plots persisted telemetry context and lists timestamped responsible roles", async () => {
  render(<TraceabilityPanel />);
  expect(await screen.findByText("Vaccine batch created")).toBeInTheDocument();
  expect(screen.getByText("Temperature chart")).toBeInTheDocument();
  expect(screen.getAllByText("55.0%")).toHaveLength(2);
  expect(screen.getByText("9.00000, 76.00000")).toBeInTheDocument();
  expect(screen.getByText(/Role: Manufacturer · Responsible: Maker A/)).toBeInTheDocument();
  expect(screen.getByText(/approved limits unavailable/)).toBeInTheDocument();
});

test("guided demo creates a fresh identifier bundle locally without writing workflow records", async () => {
  render(<GuidedDemoPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Start a fresh demo run" }));
  expect(await screen.findByText(/0 of 6 steps verified/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Run manual excursions and complete reviewed recovery/ })).toBeInTheDocument();
  expect(screen.getAllByText(/DEMO-BATCH-/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/DEMO-RUN-/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/DEMO-IOT-/).length).toBeGreaterThan(0);
  expect(localStorage.getItem("vaccine.guidedDemoRun.v1")).toContain("DEMO-BATCH-");
  expect(fetchAdminOrders).toHaveBeenCalled();
  expect(fetchBatchJourney).not.toHaveBeenCalled();
});

test("guided demo verifies both reviewed manual scenarios and automatic recovery from saved records", async () => {
  const run = { batchId: "DEMO-BATCH-E2E", deviceId: "DEMO-IOT-E2E", reference: "DEMO-RUN-E2E", createdAt: "2026-01-01T00:00:00.000Z" };
  localStorage.setItem("vaccine.guidedDemoRun.v1", JSON.stringify(run));
  fetchTraceabilityBatches.mockResolvedValue({ batches: [{ batchId: run.batchId, vaccineType: "Synthetic test" }] });
  fetchAdminOrders.mockResolvedValue({ orders: [{ notes: run.reference, orderId: "ORDER-E2E", allocatedBatchId: run.batchId, shipmentId: "SHIP-E2E" }] });
  fetchSimulatorStatuses.mockResolvedValue({ simulations: [{ deviceId: run.deviceId, batchId: run.batchId, ticksGenerated: 8 }] });
  const auditTitles = ["RESPONSE ACKNOWLEDGED", "RESPONSE ACTION TAKEN", "QUALITY REVIEW", "CLEAR AUTHORIZED", "RESPONSE RESOLVED"];
  fetchBatchJourney.mockResolvedValue({
    batch: { batchId: run.batchId, vaccineType: "Synthetic test", quantity: 10 },
    events: [
      { id: "order-e2e", kind: "order", orderId: "ORDER-E2E" },
      { id: "shipment-e2e", kind: "shipment", shipmentId: "SHIP-E2E" },
      ...["HIGH_ALERT", "HUMIDITY_ALERT"].flatMap(alertId => auditTitles.map((title, index) => ({
        id: `${alertId}-${index}`, kind: "audit", alertId, title, detail: "Synthetic response note recorded.",
      }))),
    ],
    readings: [{ id: "auto-recovery", deviceId: run.deviceId, shipmentId: "SHIP-E2E", source: "auto-simulated",
      recordedAt: "2026-01-01T00:09:00.000Z", evaluation: { violationType: "NORMAL" } }],
  });
  fetchTemperatureAlerts.mockResolvedValue({ alerts: [
    { alertId: "HIGH_ALERT", shipmentId: "SHIP-E2E", violationType: "HIGH_TEMPERATURE", context: { source: "manual-override" },
      phase: "CLEARED", requiresQualityReview: false, responseState: "RESOLVED", responseResolvedNote: "Reviewed high temperature recovery",
      excursionStartedAt: "2026-01-01T00:00:00.000Z", excursionClosedAt: "2026-01-01T00:08:00.000Z" },
    { alertId: "HUMIDITY_ALERT", shipmentId: "SHIP-E2E", violationType: "LOW_HUMIDITY", context: { source: "manual-override" },
      phase: "CLEARED", requiresQualityReview: false, responseState: "RESOLVED", responseResolvedNote: "Reviewed low humidity recovery",
      excursionStartedAt: "2026-01-01T00:04:00.000Z", excursionClosedAt: "2026-01-01T00:08:00.000Z" },
  ] });
  fetchManualSimulatorOverrides.mockResolvedValue({ overrides: [
    { shipmentId: "SHIP-E2E", status: "RELEASED", releasedAt: "2026-01-01T00:03:00.000Z" },
    { shipmentId: "SHIP-E2E", status: "RELEASED", releasedAt: "2026-01-01T00:07:00.000Z" },
  ] });

  render(<GuidedDemoPanel />);
  expect(await screen.findByText("6 of 6 steps verified from saved records")).toBeInTheDocument();
  expect(screen.getByText(/Verified cleared manual high-temperature and low-humidity alerts/)).toBeInTheDocument();
  expect(fetchTemperatureAlerts).toHaveBeenCalledWith({ batchId: run.batchId });
  expect(fetchManualSimulatorOverrides).toHaveBeenCalledWith({ shipmentId: "SHIP-E2E", status: "ALL", limit: 100 });
});
