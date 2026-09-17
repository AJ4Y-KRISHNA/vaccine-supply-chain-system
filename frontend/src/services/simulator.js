import API from "./api";

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
