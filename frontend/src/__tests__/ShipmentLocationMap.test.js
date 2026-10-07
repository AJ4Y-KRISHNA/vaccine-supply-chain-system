import React from "react";
import { render, screen } from "@testing-library/react";
import { normalizeRoutePoints } from "../components/ShipmentLocationMap";
import ShipmentLocationMap from "../components/ShipmentLocationMap";
import SharedShipmentMap from "../components/ShipmentMap";

jest.mock("../components/ShipmentMap", () => {
  const ReactModule = require("react");
  return { __esModule: true, default: jest.fn(({ currentLocation, routePoints, ariaLabel }) => currentLocation || routePoints.length
    ? ReactModule.createElement("div", { role: "application", "aria-label": ariaLabel })
    : ReactModule.createElement("div", { role: "status" }, "No saved GPS coordinates for this shipment yet.")) };
});

test("accepts valid nested or flat GPS coordinates and drops invalid samples", () => {
  const points = [
    { location: { lat: 9.9, lng: 76.2 } },
    { latitude: 10.1, longitude: 76.4 },
    { location: { lat: 91, lng: 76 } },
    { location: { lat: "unknown", lng: 76 } },
    {},
  ];
  expect(normalizeRoutePoints(points)).toEqual([
    { point: points[0], position: [9.9, 76.2] },
    { point: points[1], position: [10.1, 76.4] },
  ]);
});

test("reuses the shared Field Operator Leaflet map with saved route points", () => {
  const points = [
    { shipmentId: "SHIP-1", recordedAt: "2026-01-01T00:00:00Z", location: { lat: 9, lng: 76 } },
    { shipmentId: "SHIP-1", recordedAt: "2026-01-01T00:01:00Z", location: { lat: 9.1, lng: 76.1 } },
  ];
  render(<ShipmentLocationMap shipmentId="SHIP-1" destination="Demo Hospital" points={points} currentLocation={{ lat: 9.1, lng: 76.1 }} compact />);
  expect(SharedShipmentMap).toHaveBeenCalledWith(expect.objectContaining({
    routePoints: [{ latitude: 9, longitude: 76 }, { latitude: 9.1, longitude: 76.1 }],
    currentLocation: { lat: 9.1, lng: 76.1, recordedAt: "2026-01-01T00:01:00Z" }, routeSource: "database", compact: true,
    destinationLabel: "Demo Hospital",
  }), undefined);
});

test("does not use a stale current reading ahead of the saved GPS trail", () => {
  render(<ShipmentLocationMap shipmentId="SHIP-1" points={[
    { shipmentId: "SHIP-1", recordedAt: "2026-01-01T00:10:00Z", location: { lat: 9.1, lng: 76.1 } },
  ]} currentLocation={{ lat: 9, lng: 76, recordedAt: "2026-01-01T00:09:00Z" }} />);
  expect(SharedShipmentMap).toHaveBeenCalledWith(expect.objectContaining({ currentLocation: {
    lat: 9.1, lng: 76.1, recordedAt: "2026-01-01T00:10:00Z",
  } }), undefined);
});

test("explains when a shipment has no valid saved GPS coordinate", () => {
  render(<ShipmentLocationMap shipmentId="SHIP-EMPTY" points={[{ location: { lat: 100, lng: 0 } }]} />);
  expect(SharedShipmentMap).toHaveBeenCalledWith(expect.objectContaining({ routePoints: [], currentLocation: null }), undefined);
});
