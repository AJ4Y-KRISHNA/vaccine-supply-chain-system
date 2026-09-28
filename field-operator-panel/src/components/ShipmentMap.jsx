import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import { formatCoordinate, normalizeCoordinate, normalizeRoutePoints } from "../utils/routeData.js";

function makeIcon(className, html, size, anchor) {
  return L.divIcon({
    className,
    html,
    iconSize: size,
    iconAnchor: anchor,
  });
}

const TRUCK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>';
const truckIcons = {
  green: makeIcon(
    "field-map-icon",
    `<span class="field-map-marker field-map-marker--green">${TRUCK_SVG}</span>`,
    [38, 38],
    [19, 19],
  ),
  amber: makeIcon(
    "field-map-icon",
    `<span class="field-map-marker field-map-marker--amber">${TRUCK_SVG}</span>`,
    [38, 38],
    [19, 19],
  ),
  red: makeIcon(
    "field-map-icon",
    `<span class="field-map-marker field-map-marker--red">${TRUCK_SVG}</span>`,
    [38, 38],
    [19, 19],
  ),
  unknown: makeIcon(
    "field-map-icon",
    `<span class="field-map-marker field-map-marker--unknown">${TRUCK_SVG}</span>`,
    [38, 38],
    [19, 19],
  ),
};
const originIcon = makeIcon(
  "field-map-icon",
  '<span class="field-map-point field-map-point--origin" aria-hidden="true"></span>',
  [18, 18],
  [9, 9],
);
const destinationIcon = makeIcon(
  "field-map-icon",
  '<span class="field-map-point field-map-point--destination" aria-hidden="true"></span>',
  [18, 18],
  [9, 9],
);

function toLatLng(point) {
  const coordinate = normalizeCoordinate(point);
  return coordinate ? [coordinate.latitude, coordinate.longitude] : null;
}

function MapViewport({ location, routePoints }) {
  const map = useMap();
  const fittedRouteKey = useRef("");
  const routeKey = routePoints
    .map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`)
    .join(";");

  useEffect(() => {
    const route = normalizeRoutePoints(routePoints);
    if (route.length >= 2) {
      if (fittedRouteKey.current !== routeKey) {
        const bounds = L.latLngBounds(route.map((point) => [point.latitude, point.longitude]));
        if (location) bounds.extend(location);
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13, animate: false });
        fittedRouteKey.current = routeKey;
      } else if (location) {
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reducedMotion) map.setView(location, map.getZoom(), { animate: false });
        else map.panTo(location, { animate: true, duration: 0.55 });
      }
      return;
    }
    if (location) {
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reducedMotion) map.setView(location, Math.max(map.getZoom(), 12), { animate: false });
      else map.flyTo(location, Math.max(map.getZoom(), 12), { duration: 0.55 });
    }
  }, [location?.[0], location?.[1], map, routeKey, routePoints]);

  return null;
}

export default function ShipmentMap({
  currentLocation,
  routePoints = [],
  routeSource = "unavailable",
  statusColor = "unknown",
  originLabel = "Route origin",
  destinationLabel = "Route destination",
}) {
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const normalizedRoute = useMemo(() => normalizeRoutePoints(routePoints), [routePoints]);
  const location = toLatLng(currentLocation);
  const routeLatLngs = normalizedRoute.map((point) => [point.latitude, point.longitude]);
  const firstPoint = routeLatLngs[0];
  const lastPoint = routeLatLngs[routeLatLngs.length - 1];
  const center = location || firstPoint || [9.9312, 76.2673];
  const truckIcon = truckIcons[statusColor] || truckIcons.unknown;

  if (!location && normalizedRoute.length < 2) {
    return (
      <div className="field-map-empty" role="status" aria-label="Simulated shipment map">
        <span className="field-map-empty-icon" aria-hidden="true">
          ⌖
        </span>
        <p className="font-medium text-text-secondary">Waiting for verified route coordinates</p>
        <p className="mt-1 max-w-md text-xs leading-5 text-text-muted">
          The map will show the device position when GPS telemetry arrives. A route line appears
          only when configured simulator or backend route coordinates are available.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={false}
        className="field-operator-map"
        aria-label="Simulated shipment route map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          eventHandlers={{
            tileerror: () => setTilesUnavailable(true),
            tileload: () => setTilesUnavailable(false),
          }}
        />
        {normalizedRoute.length >= 2 && (
          <Polyline
            positions={routeLatLngs}
            pathOptions={{
              color: "var(--color-primary)",
              weight: 3,
              opacity: 0.88,
              dashArray: "7 8",
            }}
          />
        )}
        {firstPoint && <Marker position={firstPoint} icon={originIcon} title={originLabel} />}
        {lastPoint && (
          <Marker position={lastPoint} icon={destinationIcon} title={destinationLabel} />
        )}
        {location && (
          <Marker position={location} icon={truckIcon} title="Current simulated truck position" />
        )}
        <MapViewport location={location} routePoints={normalizedRoute} />
      </MapContainer>
      {tilesUnavailable && (
        <p
          className="pointer-events-none absolute inset-x-3 top-3 rounded-input border border-warning/30 bg-background/90 px-3 py-2 text-xs text-warning"
          role="status"
        >
          Map tiles are unavailable. Check the internet connection; the telemetry coordinates remain
          synthetic.
        </p>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2">
        <span className="rounded-pill border border-accent/30 bg-background/90 px-2.5 py-1 text-[10px] text-accent">
          Simulated GPS · not live vehicle tracking
        </span>
        <span className="rounded-pill border border-border bg-background/90 px-2.5 py-1 text-[10px] text-text-secondary">
          {routeSource === "backend"
            ? "Route from live session"
            : routeSource === "simulator"
              ? "Configured simulator route"
              : "Current position only"}
        </span>
      </div>
      <span className="sr-only">
        Current position: {location ? formatCoordinate(currentLocation) : "not received"}
      </span>
    </div>
  );
}
