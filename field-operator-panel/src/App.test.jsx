import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { useFieldOperatorStore } from "./stores/fieldOperatorStore.js";

vi.mock("./components/ShipmentAccessPanel.jsx", () => ({ default: () => null }));
vi.mock("./hooks/useFieldOperatorSocket.js", () => ({ default: () => ({ sendCommand: vi.fn() }) }));
vi.mock("./components/TruckRoadScene.jsx", () => ({
  default: ({ temperature, humidity, progress, statusColor }) => (
    <div
      data-testid="truck-scene"
      data-temperature={temperature}
      data-humidity={humidity}
      data-progress={progress}
      data-status={statusColor}
    />
  ),
}));
vi.mock("./components/TelemetryGauges.jsx", () => ({
  default: ({ telemetry, policy }) => (
    <div
      data-testid="bound-gauges"
      data-temperature={telemetry?.temperature}
      data-policy-max={policy?.maximumTemperature}
    />
  ),
}));
vi.mock("./components/SensorHistoryCharts.jsx", () => ({
  default: () => <div data-testid="sensor-history-charts" />,
}));
vi.mock("./components/ShipmentMap.jsx", () => ({
  default: ({ currentLocation, routePoints, routeSource }) => (
    <div
      data-testid="bound-map"
      data-latitude={currentLocation?.latitude}
      data-route-source={routeSource}
      data-route-points={JSON.stringify(routePoints)}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useFieldOperatorStore.setState({
    accessToken: "",
    role: "",
    selectedShipmentId: "",
    shipments: [],
    shipmentLoadStatus: "idle",
    connectionStatus: "idle",
    reconnectAttempt: 0,
    connectionError: "",
    initMessage: null,
    telemetry: null,
    readingHistory: [],
    alerts: [],
    progress: null,
    coldChainStatus: "unknown",
    activeOverride: null,
    overrideResult: null,
    simulationClock: null,
  });
});

describe("Step 5 live data binding", () => {
  it("makes the synthetic simulation clock explicit even before a sensor sample arrives", () => {
    render(<App />);

    const clockNotice = screen.getByText("Simulation clock:").closest('[role="status"]');
    expect(clockNotice).toHaveTextContent(/Simulation clock:\s*waiting for sensor data/);
    expect(clockNotice).toHaveTextContent(/Synthetic time; it may differ from your computer’s clock\./);
  });

  it("uses the authorized REST latest sample as a fallback for readings and the current map marker", async () => {
    useFieldOperatorStore.setState({
      accessToken: "test-token",
      role: "healthcare",
      selectedShipmentId: "SHIP-5",
      shipmentLoadStatus: "ready",
      shipments: [
        {
          shipmentId: "SHIP-5",
          batchId: "BATCH-5",
          destination: "Clinic A",
          policy: { minimumTemperature: 2, maximumTemperature: 8, approvedAt: "2026-01-01" },
          latestTelemetry: {
            temperature: 5.4,
            humidity: 56,
            batteryLevel: 94,
            location: { lat: 9.9, lng: 76.2 },
            recordedAt: "2026-01-01T00:01:00Z",
          },
        },
      ],
    });

    render(<App />);

    expect(await screen.findByTestId("bound-gauges")).toHaveAttribute("data-temperature", "5.4");
    expect(screen.getByTestId("bound-gauges")).toHaveAttribute("data-policy-max", "8");
    expect(screen.getByTestId("truck-scene")).toHaveAttribute("data-temperature", "5.4");
    expect(await screen.findByTestId("bound-map")).toHaveAttribute("data-latitude", "9.9");
    expect(screen.getByTestId("bound-map")).toHaveAttribute("data-route-source", "unavailable");
    expect(screen.getByText(/Last sample:/)).toHaveTextContent("2026");
  });

  it("loads the selected shipment's persisted simulator route for authorized roles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          simulations: [
            {
              deviceId: "DEVICE-5",
              shipmentId: "SHIP-5",
              running: true,
              route: [
                { latitude: 9.9, longitude: 76.2 },
                { latitude: 9.95, longitude: 76.25 },
                { latitude: 10, longitude: 76.3 },
              ],
            },
          ],
        }),
      }),
    );
    useFieldOperatorStore.setState({
      accessToken: "test-token",
      role: "manufacturer",
      selectedShipmentId: "SHIP-5",
      shipmentLoadStatus: "ready",
      shipments: [{ shipmentId: "SHIP-5", batchId: "BATCH-5", destination: "Clinic A" }],
    });

    render(<App />);

    const map = await screen.findByTestId("bound-map");
    await waitFor(() => expect(map).toHaveAttribute("data-route-source", "simulator"));
    expect(JSON.parse(map.getAttribute("data-route-points"))).toHaveLength(3);
    expect(screen.getByText("Configured route start")).toBeInTheDocument();
  });

  it("prefers explicit WebSocket route coordinates and progress when available", async () => {
    useFieldOperatorStore.setState({
      accessToken: "test-token",
      role: "healthcare",
      selectedShipmentId: "SHIP-5",
      shipmentLoadStatus: "ready",
      shipments: [{ shipmentId: "SHIP-5", batchId: "BATCH-5", destination: "Clinic A" }],
      telemetry: {
        temperature: 5,
        humidity: 54,
        battery: 97,
        gpsLat: 9.95,
        gpsLng: 76.25,
        simulationClock: "2026-01-01T00:02:00Z",
      },
      progress: 42,
      coldChainStatus: "normal",
      initMessage: {
        routeInfo: {
          origin: "Depot",
          destination: "Clinic A",
          totalDistanceKm: 25,
          originCoordinates: { latitude: 9.9, longitude: 76.2 },
          destinationCoordinates: { latitude: 10, longitude: 76.3 },
        },
      },
      readingHistory: [],
    });

    render(<App />);

    const map = await screen.findByTestId("bound-map");
    expect(map).toHaveAttribute("data-route-source", "backend");
    expect(JSON.parse(map.getAttribute("data-route-points"))).toHaveLength(2);
    expect(screen.getByTestId("truck-scene")).toHaveAttribute("data-progress", "42");
    expect(screen.getByText("Depot")).toBeInTheDocument();
    expect(screen.getByText("Clinic A")).toBeInTheDocument();
  });

  it("shows an unacknowledged critical banner, unread badge, and local acknowledgement action", () => {
    useFieldOperatorStore.setState({
      selectedShipmentId: "SHIP-ALERT",
      alerts: [
        {
          alertId: "ALERT-CRITICAL",
          shipmentId: "SHIP-ALERT",
          severity: "critical",
          metric: "temperature",
          value: 10.8,
          limit: 8,
          duration: 18,
          message: "Temperature exceeded the approved maximum for 18 minutes.",
          simulationClock: "2026-01-01T00:18:00.000Z",
          read: false,
          acknowledged: false,
        },
      ],
    });

    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent("Unacknowledged critical event");
    expect(screen.getByRole("link", { name: "1 unread alert" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge locally" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Acknowledged locally")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alert feed" })).toBeInTheDocument();
  });

  it("turns the truck scene red when a streamed reading reports quarantine", () => {
    useFieldOperatorStore.setState({
      selectedShipmentId: "SHIP-QUARANTINED",
      shipmentLoadStatus: "ready",
      shipments: [{ shipmentId: "SHIP-QUARANTINED", batchId: "BATCH-Q" }],
      telemetry: { temperature: 12, humidity: 55, battery: 95, status: "QUARANTINED" },
      coldChainStatus: "QUARANTINED",
      initMessage: { policyLimits: { tempMin: 2, tempMax: 8 } },
    });

    render(<App />);

    expect(screen.getByTestId("truck-scene")).toHaveAttribute("data-status", "red");
  });
});
