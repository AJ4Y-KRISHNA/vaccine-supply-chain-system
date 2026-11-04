import API from "./api";

export const fetchSimulatorInputs = async () => (await API.get("/simulator/inputs")).data;
export const setSimulationMonitoring = async (deviceId, enabled, asOf) => (await API.post(`/simulator/${encodeURIComponent(deviceId)}/monitor`, { enabled, asOf })).data;

export const createVirtualDevice = async (config) => {
  const response = await API.post("/simulator/devices", config);
  return response.data;
};

export const startSimulation = async (deviceId) => {
  const response = await API.post(`/simulator/${encodeURIComponent(deviceId)}/start`);
  return response.data;
};

export const stopSimulation = async (deviceId) => {
  const response = await API.post(`/simulator/${encodeURIComponent(deviceId)}/stop`);
  return response.data;
};

export const tickSimulation = async (deviceId) => {
  const response = await API.post(`/simulator/${encodeURIComponent(deviceId)}/tick`);
  return response.data;
};

export const resetSimulation = async (deviceId) => {
  const response = await API.post(`/simulator/${encodeURIComponent(deviceId)}/reset`);
  return response.data;
};

export const changeSimulationScenario = async (deviceId, scenario) => {
  const response = await API.post(`/simulator/${encodeURIComponent(deviceId)}/scenario`, { scenario });
  return response.data;
};

export const fetchSimulatorStatus = async (deviceId) => {
  const response = await API.get(`/simulator/${encodeURIComponent(deviceId)}/status`);
  return response.data;
};

export const fetchSimulatorStatuses = async () => {
  const response = await API.get("/simulator/status");
  return response.data;
};

export const fetchManualSimulatorPresets = async () =>
  (await API.get("/simulator/presets")).data;

export const fetchManualSimulatorOverrides = async ({ shipmentId, status = "ALL", limit = 50 } = {}) => {
  const params = new URLSearchParams();
  if (shipmentId) params.set("shipmentId", shipmentId);
  params.set("status", status);
  params.set("limit", String(limit));
  return (await API.get(`/simulator/overrides?${params.toString()}`)).data;
};

export const createManualSimulatorOverride = async (payload) =>
  (await API.post("/simulator/overrides", payload)).data;

export const updateManualSimulatorOverride = async (overrideId, payload) =>
  (await API.patch(`/simulator/overrides/${encodeURIComponent(overrideId)}`, payload)).data;

export const releaseManualSimulatorOverride = async (overrideId, payload = {}) =>
  (await API.delete(`/simulator/overrides/${encodeURIComponent(overrideId)}`, { data: payload })).data;
