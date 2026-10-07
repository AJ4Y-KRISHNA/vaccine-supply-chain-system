// Framework-agnostic shared map implementation. Each consuming app injects its
// own React and React-Leaflet runtime so separate apps do not cross React versions.
export function createShipmentMap({ React, Leaflet, MapContainer, Marker, Polyline, TileLayer, useMap }) {
  const { createElement: h, useEffect, useMemo, useRef, useState } = React;

  function finite(value) {
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeCoordinate(point) {
    if (!point || typeof point !== "object") return null;
    const latitude = finite(point.latitude ?? point.lat ?? point.location?.latitude ?? point.location?.lat);
    const longitude = finite(point.longitude ?? point.lng ?? point.location?.longitude ?? point.location?.lng);
    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
  }

  function normalizeRoutePoints(points) {
    if (!Array.isArray(points)) return [];
    return points.map(normalizeCoordinate).filter(Boolean);
  }

  function toLatLng(point) {
    const coordinate = normalizeCoordinate(point);
    return coordinate ? [coordinate.latitude, coordinate.longitude] : null;
  }

  function makeIcon(className, html, size, anchor) {
    return Leaflet.divIcon({ className, html, iconSize: size, iconAnchor: anchor });
  }

  const truckSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>';
  const truckIcons = Object.fromEntries(["green", "amber", "red", "unknown"].map((color) => [color,
    makeIcon("field-map-icon", `<span class="field-map-marker field-map-marker--${color}">${truckSvg}</span>`, [38, 38], [19, 19])]));
  const originIcon = makeIcon("field-map-icon", '<span class="field-map-point field-map-point--origin" aria-hidden="true"></span>', [18, 18], [9, 9]);
  const destinationIcon = makeIcon("field-map-icon", '<span class="field-map-point field-map-point--destination" aria-hidden="true"></span>', [18, 18], [9, 9]);
  const sourceIcons = {
    manual: makeIcon("field-map-icon", '<span class="field-map-source field-map-source--manual" aria-hidden="true"></span>', [12, 12], [6, 6]),
    csv: makeIcon("field-map-icon", '<span class="field-map-source field-map-source--csv" aria-hidden="true"></span>', [12, 12], [6, 6]),
    simulator: makeIcon("field-map-icon", '<span class="field-map-source field-map-source--simulator" aria-hidden="true"></span>', [12, 12], [6, 6]),
  };

  function MapViewport({ location, routePoints }) {
    const map = useMap();
    const fittedRouteKey = useRef("");
    const routeKey = routePoints.map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`).join(";");
    useEffect(() => {
      if (routePoints.length >= 2) {
        if (fittedRouteKey.current !== routeKey) {
          const bounds = Leaflet.latLngBounds(routePoints.map((point) => [point.latitude, point.longitude]));
          if (location) bounds.extend(location);
          map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13, animate: false });
          fittedRouteKey.current = routeKey;
        } else if (location) {
          const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
          if (reducedMotion) map.setView(location, map.getZoom(), { animate: false });
          else map.panTo(location, { animate: true, duration: 0.55 });
        }
      } else if (location) {
        const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reducedMotion) map.setView(location, Math.max(map.getZoom(), 12), { animate: false });
        else map.flyTo(location, Math.max(map.getZoom(), 12), { duration: 0.55 });
      }
    }, [location, map, routeKey, routePoints]);
    return null;
  }

  function ShipmentMap({
    currentLocation, routePoints = [], sourceMarkers = [], routeSource = "unavailable", statusColor = "unknown",
    originLabel = "Route origin", destinationLabel = "Route destination", ariaLabel = "Simulated shipment route map",
    compact = false,
  }) {
    const [tilesUnavailable, setTilesUnavailable] = useState(false);
    const normalizedRoute = useMemo(() => normalizeRoutePoints(routePoints), [routePoints]);
    const location = toLatLng(currentLocation);
    const routeLatLngs = normalizedRoute.map((point) => [point.latitude, point.longitude]);
    const plottedSources = sourceMarkers.slice(-100).map(point => ({ point, position: toLatLng(point), source: String(point.source || "simulator").toLowerCase() }))
      .filter(item => item.position && sourceIcons[item.source]);
    const firstPoint = routeLatLngs[0];
    const lastPoint = routeLatLngs[routeLatLngs.length - 1];
    const center = location || firstPoint || [9.9312, 76.2673];
    const truckIcon = truckIcons[statusColor] || truckIcons.unknown;
    const hasCoordinates = Boolean(location || normalizedRoute.length);
    const className = `shared-shipment-map${compact ? " shared-shipment-map--compact" : ""}`;

    if (!hasCoordinates) {
      return h("div", { className },
        h("div", { className: "shared-shipment-map__empty", role: "status", "aria-label": ariaLabel },
          h("span", { "aria-hidden": "true" }, "⌖"),
          h("p", null, "Waiting for verified route coordinates"),
          h("small", null, "The map will show saved simulated GPS when the sensor sends a reading with location enabled.")));
    }

    return h("div", { className },
      h(MapContainer, { center, zoom: 12, scrollWheelZoom: false, className: "field-operator-map", "aria-label": ariaLabel },
        h(TileLayer, {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
          eventHandlers: { tileerror: () => setTilesUnavailable(true), tileload: () => setTilesUnavailable(false) },
        }),
        normalizedRoute.length >= 2 && h(Polyline, { positions: routeLatLngs, pathOptions: { color: "var(--color-primary, #059669)", weight: 3, opacity: 0.88, dashArray: "7 8" } }),
        plottedSources.map(({ point, position, source }, index) => h(Marker, { key: `${point.recordedAt || "point"}-${index}`, position, icon: sourceIcons[source], title: `${source === "manual" ? "Manual" : source === "csv" ? "CSV import" : "Simulated"} GPS reading${point.recordedAt ? ` · ${point.recordedAt}` : ""}` })),
        firstPoint && h(Marker, { position: firstPoint, icon: originIcon, title: originLabel }),
        lastPoint && h(Marker, { position: lastPoint, icon: destinationIcon, title: destinationLabel }),
        location && h(Marker, { position: location, icon: truckIcon, title: "Current simulated truck position" }),
        h(MapViewport, { location, routePoints: normalizedRoute })),
      tilesUnavailable && h("p", { className: "shared-shipment-map__tiles", role: "status" }, "Map tiles are unavailable. Check the internet connection; the telemetry coordinates remain synthetic."),
      h("div", { className: "shared-shipment-map__badges" },
        h("span", null, "Simulated GPS · not live vehicle tracking"),
        h("span", null, routeSource === "backend" ? "Route from live session" : routeSource === "simulator" ? "Configured simulator route" : routeSource === "database" ? "Saved database GPS history" : "Current position only")),
      h("span", { className: "sr-only" }, `Current position: ${location ? `${location[0].toFixed(5)}, ${location[1].toFixed(5)}` : "not received"}`));
  }

  return { ShipmentMap, normalizeCoordinate, normalizeRoutePoints };
}
