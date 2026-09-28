import { describe, expect, it } from "vitest";
import {
  distanceBetweenKm,
  etaMinutes,
  formatEta,
  normalizeRoutePoints,
  routeDistanceKm,
  routePointsFromInit,
  simulatedSpeedKph,
} from "./routeData.js";

describe("routeData", () => {
  it("validates simulator route coordinates and rejects malformed paths", () => {
    expect(
      normalizeRoutePoints([
        { latitude: 9.9, longitude: 76.2 },
        { latitude: 10, longitude: 76.3 },
      ]),
    ).toEqual([
      { latitude: 9.9, longitude: 76.2 },
      { latitude: 10, longitude: 76.3 },
    ]);
    expect(normalizeRoutePoints([{ latitude: 92, longitude: 76 }])).toEqual([]);
  });

  it("reads the planned INIT route coordinate extension without guessing from labels", () => {
    expect(
      routePointsFromInit({
        origin: "Warehouse",
        destination: "Clinic",
        originCoordinates: { latitude: 9.9, longitude: 76.2 },
        destinationCoordinates: { latitude: 10, longitude: 76.3 },
      }),
    ).toHaveLength(2);
    expect(routePointsFromInit({ origin: "Warehouse", destination: "Clinic" })).toEqual([]);
  });

  it("calculates path distance and simulated speed from timestamped GPS readings", () => {
    const start = { latitude: 0, longitude: 0 };
    const end = { latitude: 0, longitude: 1 };
    const distance = distanceBetweenKm(start, end);
    expect(distance).toBeGreaterThan(111);
    expect(distance).toBeLessThan(112);
    expect(routeDistanceKm([start, end])).toBeCloseTo(distance);
    expect(
      simulatedSpeedKph([
        { gpsLat: 0, gpsLng: 0, simulationClock: "2026-01-01T00:00:00Z" },
        { gpsLat: 0, gpsLng: 1, simulationClock: "2026-01-01T01:00:00Z" },
      ]),
    ).toBeCloseTo(distance);
  });

  it("returns ETA only when distance, progress, and positive measured speed exist", () => {
    expect(etaMinutes(100, 25, 50)).toBe(90);
    expect(etaMinutes(100, null, 50)).toBeNull();
    expect(etaMinutes(100, 25, 0)).toBeNull();
    expect(formatEta(90)).toBe("1 hr 30 min");
    expect(formatEta(0)).toBe("Arrived");
  });
});
