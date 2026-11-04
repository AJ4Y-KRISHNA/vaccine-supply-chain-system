import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShipmentMap from "./ShipmentMap.jsx";

const fitBounds = vi.fn();
const setView = vi.fn();
const panTo = vi.fn();

vi.mock("leaflet", () => ({
  default: {
    divIcon: (options) => options,
    latLngBounds: (points) => ({ points, extend: vi.fn() }),
  },
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children, center, "aria-label": label }) => (
    <div data-testid="map" data-center={JSON.stringify(center)} aria-label={label}>{children}</div>
  ),
  Marker: ({ position, title }) => <span data-testid="marker" data-position={JSON.stringify(position)}>{title}</span>,
  Polyline: ({ positions }) => <span data-testid="route" data-positions={JSON.stringify(positions)} />,
  TileLayer: () => null,
  useMap: () => ({ fitBounds, setView, panTo, flyTo: vi.fn(), getZoom: () => 12 }),
}));

beforeEach(() => { fitBounds.mockClear(); setView.mockClear(); panTo.mockClear(); });
afterEach(cleanup);

describe("shared ShipmentMap", () => {
  it("plots saved route coordinates and the latest simulated position with state coloring", async () => {
    render(<ShipmentMap
      ariaLabel="Saved GPS route for SHIP-1"
      currentLocation={{ lat: 9.2, lng: 76.2 }}
      routePoints={[{ latitude: 9, longitude: 76 }, { latitude: 9.1, longitude: 76.1 }]}
      routeSource="database"
      statusColor="red"
      destinationLabel="Demo Hospital"
    />);
    expect(screen.getByTestId("map")).toHaveAccessibleName("Saved GPS route for SHIP-1");
    expect(screen.getByTestId("route")).toHaveAttribute("data-positions", "[[9,76],[9.1,76.1]]");
    expect(screen.getAllByTestId("marker").map((node) => node.textContent)).toEqual([
      "Route origin", "Demo Hospital", "Current simulated truck position",
    ]);
    expect(await screen.findByText("Saved database GPS history")).toBeInTheDocument();
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it("shows a truthful empty state instead of inventing a route", () => {
    render(<ShipmentMap routePoints={[]} currentLocation={null} />);
    expect(screen.getByRole("status", { name: "Simulated shipment route map" })).toHaveTextContent("Waiting for verified route coordinates");
    expect(screen.queryByTestId("route")).not.toBeInTheDocument();
  });
});
