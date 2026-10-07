import API from "./api";

export async function verifyShipment(shipmentId) {
  return (await API.patch(`/distribution/distributor/verify/${encodeURIComponent(shipmentId)}`, {})).data;
}

export async function dispatchShipment(shipmentId) {
  return (await API.patch(`/distribution/distributor/status/${encodeURIComponent(shipmentId)}`, { status: "In Transit" })).data;
}

export async function supplyShipment(shipmentId) {
  return (await API.patch(`/distribution/distributor/supply/${encodeURIComponent(shipmentId)}`, {})).data;
}
