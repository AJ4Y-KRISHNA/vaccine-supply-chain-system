import API from "../services/api";
import { createManualSimulatorOverride, fetchManualSimulatorOverrides, releaseManualSimulatorOverride, updateManualSimulatorOverride } from "../services/simulator";

jest.mock("../services/api", () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test("manual override helpers use the dedicated authenticated simulator endpoints", async () => {
  API.get.mockResolvedValue({ data: { overrides: [] } });
  API.post.mockResolvedValue({ data: { message: "created" } });
  API.patch.mockResolvedValue({ data: { message: "updated" } });
  API.delete.mockResolvedValue({ data: { message: "released" } });
  await fetchManualSimulatorOverrides({ shipmentId: "SHIP A", status: "ACTIVE", limit: 20 });
  await createManualSimulatorOverride({ shipmentId: "SHIP-1" });
  await updateManualSimulatorOverride("OVR/1", { reason: "Adjusted" });
  await releaseManualSimulatorOverride("OVR/1", { reason: "Resume auto" });
  expect(API.get).toHaveBeenCalledWith("/simulator/overrides?shipmentId=SHIP+A&status=ACTIVE&limit=20");
  expect(API.post).toHaveBeenCalledWith("/simulator/overrides", { shipmentId: "SHIP-1" });
  expect(API.patch).toHaveBeenCalledWith("/simulator/overrides/OVR%2F1", { reason: "Adjusted" });
  expect(API.delete).toHaveBeenCalledWith("/simulator/overrides/OVR%2F1", { data: { reason: "Resume auto" } });
});
