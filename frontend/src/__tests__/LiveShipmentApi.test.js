import API from "../services/api";
import { fetchLiveShipments } from "../services/liveShipments";

jest.mock("../services/api", () => ({ get: jest.fn() }));

test("requests the role-scoped live shipment feed with an optional shipment filter", async () => {
  API.get.mockResolvedValue({ data: { shipments: [] } });
  await fetchLiveShipments({ shipmentId: "SHIP/ONE", limit: 1 });
  expect(API.get).toHaveBeenCalledWith("/live-shipments", { params: { limit: 1, shipmentId: "SHIP/ONE" } });
});

test("defaults to a bounded page size", async () => {
  API.get.mockResolvedValue({ data: { shipments: [] } });
  await fetchLiveShipments();
  expect(API.get).toHaveBeenCalledWith("/live-shipments", { params: { limit: 25 } });
});
