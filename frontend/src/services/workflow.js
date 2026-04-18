import API from "./api";

export const fetchVaccinationWorkflow = async () => {
  const res = await API.get("/vaccinations/workflow");
  return res.data;
};

export const runVaccinationWorkflow = async (payload) => {
  const res = await API.post("/vaccinations/workflow", payload);
  return res.data;
};

export const fetchAdminUsers = async () => {
  const res = await API.get("/admin/users");
  return res.data;
};

export const fetchAdminMonitoring = async () => {
  const res = await API.get("/admin/monitoring");
  return res.data;
};

export const fetchAdminReports = async () => {
  const res = await API.get("/admin/reports");
  return res.data;
};

export const fetchAdminWorkflow = async () => {
  const res = await API.get("/admin/workflow");
  return res.data;
};

export const runAdminSentiment = async (text) => {
  const res = await API.post("/admin/sentiment", { text });
  return res.data;
};

export const fetchManufacturerWorkflow = async () => {
  const res = await API.get("/manufacturer/batches");
  return res.data;
};

export const fetchDistributorWorkflow = async () => {
  const res = await API.get("/distribution/distributor/workflow");
  return res.data;
};

export const createHospitalOrder = async (payload) => {
  const res = await API.post("/orders/hospital", payload);
  return res.data;
};

export const fetchHospitalOrders = async (hospital) => {
  const query = hospital ? `?hospital=${encodeURIComponent(hospital)}` : "";
  const res = await API.get(`/orders/hospital${query}`);
  return res.data;
};

export const fetchAdminOrders = async () => {
  const res = await API.get("/orders/admin");
  return res.data;
};

export const reviewAdminOrder = async (orderId, payload) => {
  const res = await API.patch(`/orders/${orderId}/review`, payload);
  return res.data;
};

export const fetchDistributorOrders = async () => {
  const res = await API.get("/orders/distributor");
  return res.data;
};

export const confirmHospitalDelivery = async (shipmentId, payload) => {
  const res = await API.patch(`/distribution/healthcare/confirm/${encodeURIComponent(shipmentId)}`, payload);
  return res.data;
};
