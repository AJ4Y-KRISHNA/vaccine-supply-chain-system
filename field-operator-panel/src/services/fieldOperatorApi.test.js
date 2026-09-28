import { afterEach, describe, expect, it, vi } from "vitest";
import { getSimulatorRoutes, listInTransitShipments, signIn } from "./fieldOperatorApi.js";

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

describe("fieldOperatorApi", () => {
  it("uses the existing login request shape and requests scoped live shipments with the JWT", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ token: "access.jwt", role: "manufacturer" }))
      .mockResolvedValueOnce(
        jsonResponse({
          shipments: [
            { shipmentId: "SHIP-1", status: "In Transit" },
            { shipmentId: "SHIP-2", status: "Delivered" },
            { shipmentId: "SHIP-3", status: "Transit to clinic" },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      signIn({ email: "maker@example.test ", password: "secret", role: "manufacturer" }),
    ).resolves.toMatchObject({ token: "access.jwt" });
    const shipments = await listInTransitShipments("access.jwt");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/login");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: "maker@example.test",
      password: "secret",
      role: "manufacturer",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/live-shipments?limit=100");
    expect(fetchMock.mock.calls[1][1].headers.get("Authorization")).toBe("Bearer access.jwt");
    expect(shipments.map((shipment) => shipment.shipmentId)).toEqual(["SHIP-1", "SHIP-3"]);
  });

  it("loads persisted simulator route configs with the session token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          simulations: [{ shipmentId: "SHIP-1", route: [{ latitude: 9.9, longitude: 76.2 }] }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getSimulatorRoutes("access.jwt")).resolves.toMatchObject([
      { shipmentId: "SHIP-1" },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/simulator/status");
    expect(fetchMock.mock.calls[0][1].headers.get("Authorization")).toBe("Bearer access.jwt");
  });
});
