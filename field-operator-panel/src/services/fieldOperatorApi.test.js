import { afterEach, describe, expect, it, vi } from "vitest";
import { getShipmentTemperatureHistory } from "./fieldOperatorApi.js";

afterEach(() => vi.unstubAllGlobals());

describe("persisted shipment history API", () => {
  it("follows every cursor page and returns normalized chart points", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        records: [
          { readingId: "r1", sequenceNumber: 1, temperature: 4.1, humidity: 55, batteryLevel: 99,
            location: { lat: 9.9, lng: 76.2 }, recordedAt: "2026-01-01T00:00:00.000Z" },
          { readingId: "r2", sequenceNumber: 2, temperature: 4.2, humidity: 56, batteryLevel: 98,
            location: { lat: 9.91, lng: 76.21 }, recordedAt: "2026-01-01T00:01:00.000Z" },
        ], hasMore: true, nextCursor: "cursor-2",
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        records: [{ readingId: "r3", sequenceNumber: 3, temperature: 4.3, humidity: 57,
          location: { lat: 9.92, lng: 76.22 }, recordedAt: "2026-01-01T00:02:00.000Z" }],
        hasMore: false, nextCursor: null,
      }) });
    vi.stubGlobal("fetch", fetchMock);

    const history = await getShipmentTemperatureHistory("token", "SHIP-1", { pageSize: 2 });

    expect(history).toHaveLength(3);
    expect(history.map(point => point.readingId)).toEqual(["r1", "r2", "r3"]);
    expect(history[0]).toMatchObject({ gpsLat: 9.9, gpsLng: 76.2, battery: 99, simulationClock: "2026-01-01T00:00:00.000Z" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=cursor-2");
  });
});
