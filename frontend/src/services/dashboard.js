import API from "./api";

export const fetchDistributorDashboard = async () => {
  const res = await API.get("/dashboard/distributor");
  return res.data;
};

export const fetchManufacturerDashboard = async () => {
  const res = await API.get("/dashboard/manufacturer");
  return res.data;
};

export const signManufacturerBatchRelease = async (batchId, payload) => {
  const res = await API.post(`/manufacturer/batch/${encodeURIComponent(batchId)}/sign-release`, payload);
  return res.data;
};

export const fetchHealthcareDashboard = async () => {
  const res = await API.get("/dashboard/healthcare");
  return res.data;
};

export const fetchAdminDashboard = async () => {
  const res = await API.get("/dashboard/admin");
  return res.data;
};
