import API from "./api";

function toQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const fetchTemperatureAlerts = async (filters) => {
  const response = await API.get(`/alerts${toQuery(filters)}`);
  return response.data;
};

export const fetchTemperatureAlertSummary = async () => {
  const response = await API.get("/alerts/summary");
  return response.data;
};

export const fetchTemperatureNotifications = async () => {
  const response = await API.get("/alerts/notifications");
  return response.data;
};

export const acknowledgeTemperatureAlert = async (alertId) => {
  const response = await API.patch(`/alerts/${encodeURIComponent(alertId)}/acknowledge`);
  return response.data;
};

export const resolveTemperatureAlert = async (alertId, reason) => {
  const response = await API.patch(`/alerts/${encodeURIComponent(alertId)}/resolve`, { reason });
  return response.data;
};

export const markTemperatureNotificationRead = async (notificationId) => {
  const response = await API.patch(`/alerts/notifications/${encodeURIComponent(notificationId)}/read`);
  return response.data;
};

export const updateBatchTemperaturePolicy = async (batchId, policy) => {
  const response = await API.put(`/alerts/policies/batch/${encodeURIComponent(batchId)}`, policy);
  return response.data;
};

export const fetchColdChainAlert = async (alertId) => (await API.get(`/alerts/${encodeURIComponent(alertId)}`)).data;
export const actOnColdChainAlert = async (alertId, action, evidence) =>
  (await API.patch(`/alerts/${encodeURIComponent(alertId)}/${action}`, evidence)).data;
export const approveColdChainPolicy = async (batchId, policy) =>
  (await API.post(`/alerts/policies/batch/${encodeURIComponent(batchId)}/approve`, policy)).data;
export const fetchColdChainPolicy = async (batchId) =>
  (await API.get(`/alerts/policies/batch/${encodeURIComponent(batchId)}`)).data;
export const checkColdChainTelemetry = async (batchId, asOf) =>
  (await API.post("/alerts/telemetry/check", { batchId, asOf })).data;
