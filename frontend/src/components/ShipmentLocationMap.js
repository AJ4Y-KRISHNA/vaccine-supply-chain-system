import React from "react";
import ShipmentMap from "./ShipmentMap";

function validCoordinate(point) {
  const lat = Number(point?.location?.lat ?? point?.lat ?? point?.latitude);
  const lng = Number(point?.location?.lng ?? point?.lng ?? point?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? [lat, lng]
    : null;
}

export function normalizeRoutePoints(points = []) {
  return points.map(point => ({ point, position: validCoordinate(point) }))
    .filter(item => item.position);
}

export default function ShipmentLocationMap({ shipmentId, destination, points = [], currentLocation, compact = false, statusColor = "unknown" }) {
  const normalized = normalizeRoutePoints(points);
  const routePoints = normalized.map(({ point, position }) => ({ latitude: position[0], longitude: position[1], source: point.source }));
  const sourceMarkers = normalized.map(({ point, position }) => ({ latitude: position[0], longitude: position[1], source: point.source, recordedAt: point.recordedAt }));
  const current = validCoordinate(currentLocation);
  const latestHistoryPoint = normalized[normalized.length - 1]?.point;
  const currentTimestamp = Date.parse(currentLocation?.recordedAt || "");
  const historyTimestamp = Date.parse(latestHistoryPoint?.recordedAt || "");
  const currentIsNewer = Boolean(current) && (!latestHistoryPoint
    || (Number.isFinite(currentTimestamp) && Number.isFinite(historyTimestamp) && currentTimestamp >= historyTimestamp));
  const lastHistoryPosition = normalized[normalized.length - 1]?.position;
  const liveLocation = currentIsNewer && (!lastHistoryPosition || current[0] !== lastHistoryPosition[0] || current[1] !== lastHistoryPosition[1])
    ? currentLocation : (latestHistoryPoint ? { ...latestHistoryPoint.location, recordedAt: latestHistoryPoint.recordedAt } : null);
  return <div className={`shipment-map${compact ? " shipment-map--compact" : ""}`}>
    <ShipmentMap currentLocation={liveLocation} routePoints={routePoints} sourceMarkers={sourceMarkers} routeSource="database" statusColor={statusColor}
      destinationLabel={destination || "Route destination"} compact={compact}
      ariaLabel={`Saved simulated GPS route for shipment ${shipmentId}`} />
    <div className="shipment-map__caption"><span>{normalized.length} saved GPS points · green simulated / purple manual / blue CSV</span>
      <span>{destination ? `Destination: ${destination}` : "Destination not recorded"}</span></div>
  </div>;
}
