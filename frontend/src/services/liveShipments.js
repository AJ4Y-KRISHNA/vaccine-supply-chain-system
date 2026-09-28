import API from "./api";

export async function fetchLiveShipments({ shipmentId, limit = 25 } = {}) {
  const params = { limit };
  if (shipmentId) params.shipmentId = shipmentId;
  const response = await API.get("/live-shipments", { params });
  return response.data;
}
