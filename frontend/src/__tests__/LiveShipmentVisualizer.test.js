import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LiveShipmentVisualizer, { shipmentIsQuarantined, shipmentIsStopped, shipmentProgress, shipmentTone } from "../components/LiveShipmentVisualizer";
import { fetchLiveShipments } from "../services/liveShipments";
import { fetchTemperatureAlerts } from "../services/alerts";

jest.mock("../services/liveShipments", () => ({ fetchLiveShipments: jest.fn() }));
jest.mock("../services/alerts", () => ({ fetchTemperatureAlerts: jest.fn() }));

const normalShipment = {
  shipmentId: "SHIP-1", batchId: "BATCH-1", destination: "Demo Hospital", status: "In Transit",
  latestTelemetry: { deviceId: "DEV-1", temperature: 5, humidity: 60, batteryLevel: 90, recordedAt: "2026-01-01T00:00:00Z", location: { lat: 9, lng: 76 } },
  policy: { minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 40, maximumHumidity: 80, criticalBatteryPercent: 10 },
};
const withRouter = element => <MemoryRouter>{element}</MemoryRouter>;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.setItem("token", "test-access-token");
  fetchLiveShipments.mockResolvedValue({ shipments: [normalShipment] });
  fetchTemperatureAlerts.mockResolvedValue({ alerts: [] });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => jest.restoreAllMocks());

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

test("shows a simulated data-bound truck and links shipment details", async () => {
  render(withRouter(<LiveShipmentVisualizer shipmentId="SHIP-1" maxVisible={1} />));
  expect(await screen.findByText("SHIP-1")).toBeInTheDocument();
  expect(screen.getByLabelText(/Simulated shipment truck, 58% through persisted shipment workflow/)).toBeInTheDocument();
  expect(screen.getByLabelText(/TEMP 5°C; configured range 2 to 8°C/)).toBeInTheDocument();
  expect(screen.getByLabelText(/RH 60%; configured range 40 to 80%/)).toBeInTheDocument();
  expect(screen.getByLabelText("Latest saved sensor reading for SHIP-1")).toHaveTextContent("5.0°C");
  expect(screen.getByLabelText("Latest saved sensor reading for SHIP-1")).toHaveTextContent("60.0%");
  expect(screen.getByText(/GPS 9.0000, 76.0000/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open SHIP-1 shipment alerts and details/ })).toHaveAttribute("href", "/live-shipments?shipmentId=SHIP-1");
});

test("opens related alert details and marks a held shipment critical", async () => {
  fetchTemperatureAlerts.mockResolvedValue({ alerts: [{ shipmentId: "SHIP-1", severity: "CRITICAL", phase: "QUARANTINED", requiresQualityReview: true, reason: "Recorded excursion", recommendedAction: "Request quality review" }] });
  render(withRouter(<LiveShipmentVisualizer shipmentId="SHIP-1" maxVisible={1} />));
  expect(await screen.findByText("Recorded excursion")).toBeInTheDocument();
  expect(screen.getByText("Quarantined — pending review")).toBeInTheDocument();
  expect(screen.getByLabelText(/stationary/)).toBeInTheDocument();
  expect(document.querySelector(".live-shipment--alert-active .live-shipment__status-light")).toBeInTheDocument();
});

test("leaves a delivered shipment in the final visible route position", async () => {
  fetchLiveShipments.mockResolvedValue({ shipments: [{ ...normalShipment, status: "Delivery Confirmed by Hospital" }] });
  render(withRouter(<LiveShipmentVisualizer shipmentId="SHIP-1" maxVisible={1} />));
  expect(await screen.findByLabelText(/100% through persisted shipment workflow, stationary/)).toBeInTheDocument();
  expect(document.querySelector(".live-shipment__truck")).toHaveStyle({ transform: "translateX(480px)" });
});

test("shows more shipments on demand and respects reduced-motion preference", async () => {
  fetchLiveShipments.mockResolvedValue({ shipments: Array.from({ length: 5 }, (_, i) => ({ ...normalShipment, shipmentId: `SHIP-${i + 1}` })) });
  window.matchMedia = jest.fn().mockImplementation(query => ({ matches: query.includes("prefers-reduced-motion"), media: query, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() }));
  const { container } = render(withRouter(<LiveShipmentVisualizer maxVisible={2} />));
  expect((await screen.findAllByText(/SHIP-/)).length).toBeGreaterThanOrEqual(2);
  expect(container.querySelector('[data-reduced-motion="true"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show 2 more of 5 shipments" }));
  await waitFor(() => expect(screen.getByText("SHIP-4")).toBeInTheDocument());
});
