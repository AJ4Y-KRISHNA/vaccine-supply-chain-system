import API from "../services/api";
import { fetchBatchLocationHistory, fetchLiveShipments } from "../services/liveShipments";

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

test("requests role-scoped batch GPS history with a bounded point count", async () => {
  API.get.mockResolvedValue({ data: { batchId: "B-1", points: [] } });
  await fetchBatchLocationHistory("B-1", { limit: 200 });
  expect(API.get).toHaveBeenCalledWith("/location-history/B-1", { params: { limit: 200 } });
});
