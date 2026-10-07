import API from "./api";

export async function fetchLiveShipments({ shipmentId, limit = 25 } = {}) {
  const params = { limit };
  if (shipmentId) params.shipmentId = shipmentId;
  const response = await API.get("/live-shipments", { params });
  return response.data;
}

export async function fetchBatchLocationHistory(batchId, { limit = 500 } = {}) {
  const response = await API.get(`/location-history/${encodeURIComponent(batchId)}`, { params: { limit } });
  return response.data;
}

export async function fetchShipmentTemperatureHistory(shipmentId, { limit = 500, latest = true } = {}) {
  const response = await API.get(`/live-shipments/${encodeURIComponent(shipmentId)}/temperature-history`, { params: { limit, latest } });
  return response.data;
}
