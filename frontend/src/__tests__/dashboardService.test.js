import axios from "axios";
import {
  fetchDistributorDashboard,
  fetchManufacturerDashboard,
  fetchHealthcareDashboard,
  fetchAdminDashboard,
} from "../services/dashboard";

jest.mock("axios", () => {
  const client = {
    get: jest.fn(),
    post: jest.fn(),
    interceptors: { request: { use: jest.fn() } },
  };
  client.create = jest.fn(() => client);
  return { __esModule: true, default: client };
});

describe("dashboard service", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test("fetchDistributorDashboard returns data", async () => {
    axios.get.mockResolvedValue({ data: { totals: { totalShipments: 1 } } });
    const res = await fetchDistributorDashboard();
    expect(res.totals.totalShipments).toBe(1);
  });

  test("fetchAdminDashboard calls correct path", async () => {
    axios.get.mockResolvedValue({ data: { metrics: {} } });
    await fetchAdminDashboard();
    expect(axios.get).toHaveBeenCalledWith("/dashboard/admin");
  });
});
