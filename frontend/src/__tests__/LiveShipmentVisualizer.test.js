import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LiveShipmentVisualizer, { shipmentIsQuarantined, shipmentIsStopped, shipmentProgress, shipmentTone } from "../components/LiveShipmentVisualizer";
import { fetchBatchLocationHistory, fetchLiveShipments, fetchShipmentTemperatureHistory } from "../services/liveShipments";
import { fetchTemperatureAlerts } from "../services/alerts";

jest.mock("../services/liveShipments", () => ({ fetchLiveShipments: jest.fn(), fetchBatchLocationHistory: jest.fn(), fetchShipmentTemperatureHistory: jest.fn() }));
jest.mock("../services/alerts", () => ({ fetchTemperatureAlerts: jest.fn() }));
jest.mock("../components/ShipmentLocationMap", () => ({
  __esModule: true,
  default: ({ shipmentId, points, currentLocation }) => {
    const React = require("react");
    const position = currentLocation ? `${Number(currentLocation.lat).toFixed(4)}, ${Number(currentLocation.lng).toFixed(4)}` : "no latest GPS";
    return React.createElement("div", { "data-testid": "shipment-map" }, `${shipmentId}: ${points.length} saved GPS points; ${position}`);
  },
}));

const normalShipment = {
  shipmentId: "SHIP-1", batchId: "BATCH-1", destination: "Demo Hospital", status: "In Transit",
  latestTelemetry: { deviceId: "DEV-1", temperature: 5, humidity: 60, batteryLevel: 90, recordedAt: "2026-01-01T00:00:00Z", location: { lat: 9, lng: 76 } },
  policy: { minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 40, maximumHumidity: 80, criticalBatteryPercent: 10 },
};
const withRouter = element => <MemoryRouter>{element}</MemoryRouter>;
const originalWebSocket = global.WebSocket;

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.setItem("token", "test-access-token");
  fetchLiveShipments.mockResolvedValue({ shipments: [normalShipment] });
  fetchBatchLocationHistory.mockResolvedValue({ points: [{ shipmentId: "SHIP-1", batchId: "BATCH-1", recordedAt: "2026-01-01T00:00:00Z", location: { lat: 9, lng: 76 } }] });
  fetchShipmentTemperatureHistory.mockResolvedValue({ records: [
    { temperature: 5, humidity: 60, recordedAt: "2026-01-01T00:00:00Z" },
    { temperature: 9, humidity: 85, recordedAt: "2026-01-01T00:01:00Z" },
  ] });
  fetchTemperatureAlerts.mockResolvedValue({ alerts: [] });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => { jest.restoreAllMocks(); global.WebSocket = originalWebSocket; });

test("maps persisted workflow states to fixed progress and halts at delivery", () => {
  expect(shipmentProgress({ status: "Pending" })).toBe(6);
  expect(shipmentProgress({ status: "Verified" })).toBe(28);
  expect(shipmentProgress({ status: "In Transit" })).toBe(58);
  expect(shipmentProgress({ status: "Supplied to Vaccination Center" })).toBe(82);
  expect(shipmentProgress({ status: "Delivery Confirmed by Hospital" })).toBe(100);
  expect(shipmentIsStopped({ status: "In Transit" })).toBe(false);
  expect(shipmentIsStopped({ status: "Delivered" })).toBe(true);
});

test("uses configured policy and reading to distinguish normal, warning, and quarantine", () => {
  expect(shipmentTone(normalShipment)).toBe("normal");
  expect(shipmentTone({ ...normalShipment, latestTelemetry: { ...normalShipment.latestTelemetry, temperature: 9 } })).toBe("warning");
  const activeHold = { requiresQualityReview: true, phase: "QUARANTINED" };
  expect(shipmentIsQuarantined(normalShipment, [activeHold])).toBe(true);
  expect(shipmentIsStopped(normalShipment, true)).toBe(true);
  expect(shipmentTone(normalShipment, [activeHold])).toBe("critical");
  expect(shipmentTone({ ...normalShipment, policy: null })).toBe("unknown");
});

test("shows a geographic view built from persisted shipment GPS and links shipment details", async () => {
  render(withRouter(<LiveShipmentVisualizer shipmentId="SHIP-1" maxVisible={1} />));
  expect(await screen.findByText("SHIP-1")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("shipment-map")).toHaveTextContent("SHIP-1: 1 saved GPS points; 9.0000, 76.0000"));
  expect(fetchBatchLocationHistory).toHaveBeenCalledWith("BATCH-1", { limit: 500 });
  expect(screen.getByLabelText("Latest saved sensor reading for SHIP-1")).toHaveTextContent("5.0°C");
  expect(screen.getByLabelText("Latest saved sensor reading for SHIP-1")).toHaveTextContent("60.0%");
  expect(await screen.findByRole("img", { name: /Temperature chart, approved range 2 to 8/ })).toBeInTheDocument();
  expect(screen.getByLabelText(/Synthetic sensor history SHIP-1/)).toHaveTextContent("Allowed 2–8°C");
  expect(screen.getByText(/Degraded · polling fallback/)).toBeInTheDocument();
  expect(fetchShipmentTemperatureHistory).toHaveBeenCalledWith("SHIP-1", { limit: 500, latest: true });
  expect(screen.getByRole("link", { name: /Open shipment details/ })).toHaveAttribute("href", "/live-shipments?shipmentId=SHIP-1");
});

test("a pushed reading refreshes the chart through the latest-history API in about one second", async () => {
  class BrowserMockSocket {
    static CONNECTING = 0; static OPEN = 1; static updated = false;
    constructor() { this.readyState = 0; BrowserMockSocket.instance = this; setTimeout(() => { this.readyState = 1; this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ type: "READY" }) }); }, 0); }
    close() { this.readyState = 3; this.onclose?.(); }
    sendEvent(type) { BrowserMockSocket.updated = true; this.onmessage?.({ data: JSON.stringify({ type, data: { temperature: 12 } }) }); }
  }
  const oldSocket = global.WebSocket;
  global.WebSocket = BrowserMockSocket;
  fetchLiveShipments.mockImplementation(() => Promise.resolve({ shipments: [{ ...normalShipment,
    latestTelemetry: { ...normalShipment.latestTelemetry, temperature: BrowserMockSocket.updated ? 12 : 5 } }] }));
  fetchShipmentTemperatureHistory.mockImplementation(() => Promise.resolve({ records: !BrowserMockSocket.updated
    ? [{ temperature: 5, humidity: 60 }, { temperature: 9, humidity: 85 }]
    : [{ temperature: 5, humidity: 60 }, { temperature: 12, humidity: 90 }] }));
  render(withRouter(<LiveShipmentVisualizer shipmentId="SHIP-1" maxVisible={1} />));
  await screen.findByText("Live");
  await waitFor(() => expect(fetchShipmentTemperatureHistory).toHaveBeenCalled());
  const temperatureChart = screen.getByRole("img", { name: /Temperature chart/ });
  const initialPath = temperatureChart.querySelector('path[stroke="#0f766e"]').getAttribute("d");
  const eventStartedAt = Date.now();
  act(() => BrowserMockSocket.instance.sendEvent("READING"));
  await waitFor(() => expect(fetchShipmentTemperatureHistory.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 1000 });
  await waitFor(() => expect(temperatureChart.querySelector('path[stroke="#0f766e"]').getAttribute("d")).not.toBe(initialPath), { timeout: 1000 });
  expect(fetchShipmentTemperatureHistory.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(Date.now() - eventStartedAt).toBeLessThan(1000);
  global.WebSocket = oldSocket;
});

test("does not attach ambiguous batch-only GPS rows to one of multiple shipments", async () => {
  fetchLiveShipments.mockResolvedValue({ shipments: [normalShipment, { ...normalShipment, shipmentId: "SHIP-2" }] });
  fetchBatchLocationHistory.mockResolvedValue({ points: [
    { batchId: "BATCH-1", location: { lat: 8.9, lng: 75.9 } },
    { batchId: "BATCH-1", shipmentId: "SHIP-2", location: { lat: 9.1, lng: 76.1 } },
  ] });
  render(withRouter(<LiveShipmentVisualizer maxVisible={2} />));
  await waitFor(() => expect(screen.getAllByTestId("shipment-map")).toHaveLength(2));
  const cards = screen.getAllByRole("article");
  await waitFor(() => {
    expect(within(cards[0]).getByTestId("shipment-map")).toHaveTextContent("SHIP-1: 0 saved GPS points");
    expect(within(cards[1]).getByTestId("shipment-map")).toHaveTextContent("SHIP-2: 1 saved GPS points");
  });
  expect(fetchBatchLocationHistory).toHaveBeenCalledTimes(1);
});

test("allows legacy batch-only GPS history when exactly one shipment uses the batch", async () => {
  fetchBatchLocationHistory.mockResolvedValue({ points: [{ batchId: "BATCH-1", location: { lat: 9.2, lng: 76.2 } }] });
  render(withRouter(<LiveShipmentVisualizer shipmentId="SHIP-1" maxVisible={1} />));
  await waitFor(() => expect(screen.getByTestId("shipment-map")).toHaveTextContent("SHIP-1: 1 saved GPS points"));
});

test("opens related alert details and marks a held shipment critical", async () => {
  fetchTemperatureAlerts.mockResolvedValue({ alerts: [{ shipmentId: "SHIP-1", severity: "CRITICAL", phase: "QUARANTINED", requiresQualityReview: true, reason: "Recorded excursion", recommendedAction: "Request quality review" }] });
  render(withRouter(<LiveShipmentVisualizer shipmentId="SHIP-1" maxVisible={1} />));
  expect(await screen.findByText("Recorded excursion")).toBeInTheDocument();
  expect(screen.getByText("Quarantined — pending review")).toBeInTheDocument();
  const card = screen.getByLabelText(/Shipment SHIP-1: Quarantined — pending review/);
  expect(card).toHaveClass("live-shipment--alert-active");
});

test("keeps the quarantine display after the sensor reading recovers", async () => {
  fetchLiveShipments.mockResolvedValue({ shipments: [{ ...normalShipment, batchColdChainStatus: "Quarantined—pending quality review",
    batchColdChainHoldAlertIds: ["TEMP-E2E"], latestTelemetry: { ...normalShipment.latestTelemetry, temperature: 5 } }] });
  fetchTemperatureAlerts.mockResolvedValue({ alerts: [] });
  render(withRouter(<LiveShipmentVisualizer shipmentId="SHIP-1" maxVisible={1} />));
  const card = await screen.findByLabelText(/Shipment SHIP-1: Quarantined — pending review/);
  expect(card).toHaveClass("live-shipment--critical");
  expect(screen.getByText("Quarantined — pending review")).toBeInTheDocument();
  expect(screen.getByLabelText("Latest saved sensor reading for SHIP-1")).toHaveTextContent("5.0°C");
});

test("shows delivered workflow status without fabricating geographic movement", async () => {
  fetchLiveShipments.mockResolvedValue({ shipments: [{ ...normalShipment, status: "Delivery Confirmed by Hospital" }] });
  render(withRouter(<LiveShipmentVisualizer shipmentId="SHIP-1" maxVisible={1} />));
  expect(await screen.findByText("Delivered")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("shipment-map")).toHaveTextContent("SHIP-1: 1 saved GPS points"));
});

test("shows more shipment cards on demand", async () => {
  fetchLiveShipments.mockResolvedValue({ shipments: Array.from({ length: 5 }, (_, i) => ({ ...normalShipment, shipmentId: `SHIP-${i + 1}` })) });
  render(withRouter(<LiveShipmentVisualizer maxVisible={2} />));
  expect((await screen.findAllByText(/SHIP-/)).length).toBeGreaterThanOrEqual(2);
  await waitFor(() => expect(screen.getAllByTestId("shipment-map")).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Show 2 more of 5 shipments" }));
  await waitFor(() => expect(screen.getByText("SHIP-4")).toBeInTheDocument());
  await waitFor(() => expect(screen.getAllByTestId("shipment-map")).toHaveLength(4));
});
