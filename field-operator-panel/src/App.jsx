import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Clock3,
  Droplets,
  MapPin,
  Route,
  ShieldCheck,
  Snowflake,
  Thermometer,
  Truck,
  Wifi,
  WifiOff,
} from "lucide-react";
import TruckRoadScene from "./components/TruckRoadScene.jsx";
import ShipmentAccessPanel from "./components/ShipmentAccessPanel.jsx";
import useFieldOperatorSocket from "./hooks/useFieldOperatorSocket.js";
import { getSimulatorRoutes } from "./services/fieldOperatorApi.js";
import { useFieldOperatorStore } from "./stores/fieldOperatorStore.js";
import {
  etaMinutes,
  formatCoordinate,
  formatEta,
  normalizeCoordinate,
  normalizeRoutePoints,
  routeDistanceKm,
  routePointsFromInit,
  simulatedSpeedKph,
} from "./utils/routeData.js";

const ShipmentMap = lazy(() => import("./components/ShipmentMap.jsx"));
const TelemetryGauges = lazy(() => import("./components/TelemetryGauges.jsx"));

const sections = [
  { number: "01", title: "Truck scene", subtitle: "Shipment and cold-chain state", icon: Truck },
  {
    number: "02",
    title: "Live readings",
    subtitle: "Temperature, humidity and device health",
    icon: Activity,
  },
  { number: "03", title: "Route map", subtitle: "Simulated GPS position and route", icon: MapPin },
  {
    number: "04",
    title: "ETA & route info",
    subtitle: "Destination, distance and delivery estimate",
    icon: Route,
  },
  {
    number: "05",
    title: "Manual override",
    subtitle: "Operator-requested environment changes",
    icon: ShieldCheck,
  },
  { number: "06", title: "Alert feed", subtitle: "Explainable cold-chain events", icon: Bell },
  {
    number: "07",
    title: "Sensor history",
    subtitle: "Temperature and humidity over time",
    icon: Activity,
  },
];

function SectionHeading({ number, title, subtitle, icon: Icon, state = "Awaiting data" }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="mt-0.5 rounded-input border border-border bg-surface-raised p-2 text-primary">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="operator-mono text-xs text-text-muted">{number}</span>
          <h2 id={`section-${number}`} className="text-base font-semibold text-text-primary">
            {title}
          </h2>
        </div>
        <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
      </div>
      <span className="rounded-pill border border-border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-text-secondary">
        {state}
      </span>
    </div>
  );
}

function Placeholder({ children, className = "" }) {
  return (
    <div
      className={`flex min-h-32 flex-col items-center justify-center rounded-input border border-dashed border-border bg-background/60 px-5 py-6 text-center ${className}`}
    >
      <p className="text-sm font-medium text-text-secondary">{children}</p>
    </div>
  );
}

function RouteDatum({ label, value = "Unavailable" }) {
  return (
    <div className="border-b border-border/70 py-3 last:border-0">
      <p className="text-xs uppercase tracking-wide text-text-muted">{label}</p>
      <p className="operator-mono mt-1 break-words text-sm text-text-primary">{value}</p>
    </div>
  );
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRestTelemetry(reading) {
  if (!reading) return null;
  const location = reading.location || {};
  return {
    temperature: finite(reading.temperature),
    humidity: finite(reading.humidity),
    battery: finite(reading.battery ?? reading.batteryLevel),
    speed: finite(reading.speed ?? reading.speedKph),
    gpsLat: finite(reading.gpsLat ?? location.lat ?? reading.latitude),
    gpsLng: finite(reading.gpsLng ?? location.lng ?? reading.longitude),
    vehicleId: reading.vehicleId || null,
    deviceId: reading.deviceId || null,
    simulationClock: reading.simulationClock || reading.recordedAt || reading.timestamp || null,
    source: reading.source || "unknown",
  };
}

function resolvePolicy(shipment, initMessage) {
  const saved = shipment?.policy || {};
  const live = initMessage?.policyLimits || {};
  return {
    minimumTemperature: finite(live.tempMin ?? live.minimumTemperature ?? saved.minimumTemperature),
    maximumTemperature: finite(live.tempMax ?? live.maximumTemperature ?? saved.maximumTemperature),
    minimumHumidity: finite(live.humidityMin ?? live.minimumHumidity ?? saved.minimumHumidity),
    maximumHumidity: finite(live.humidityMax ?? live.maximumHumidity ?? saved.maximumHumidity),
    criticalBatteryPercent: finite(live.criticalBatteryPercent ?? saved.criticalBatteryPercent),
    approvedAt: live.approvedAt || saved.approvedAt || null,
    sourceReference: live.sourceReference || saved.sourceReference || null,
  };
}

function resolveStatusColor(status, telemetry, policy, shipment) {
  const trustedStatus = status && status !== "unknown" ? status : null;
  const statusText = String(
    trustedStatus || shipment?.coldChainStatus || shipment?.batchColdChainStatus || "",
  )
    .trim()
    .toLowerCase();
  if (
    statusText.includes("quarantin") ||
    statusText.includes("critical") ||
    shipment?.coldChainHoldAlertIds?.length ||
    shipment?.batchColdChainHoldAlertIds?.length
  )
    return "red";
  if (
    statusText.includes("review") ||
    statusText.includes("warning") ||
    statusText.includes("excursion")
  )
    return "amber";

  const hasTemperaturePolicy =
    policy.minimumTemperature !== null && policy.maximumTemperature !== null;
  const hasHumidityPolicy = policy.minimumHumidity !== null && policy.maximumHumidity !== null;
  if (!telemetry || (!hasTemperaturePolicy && !hasHumidityPolicy)) return "unknown";
  const outsideTemperature =
    hasTemperaturePolicy &&
    telemetry.temperature !== null &&
    (telemetry.temperature < policy.minimumTemperature ||
      telemetry.temperature > policy.maximumTemperature);
  const outsideHumidity =
    hasHumidityPolicy &&
    telemetry.humidity !== null &&
    (telemetry.humidity < policy.minimumHumidity || telemetry.humidity > policy.maximumHumidity);
  const criticallyLowBattery =
    policy.criticalBatteryPercent !== null &&
    telemetry.battery !== null &&
    telemetry.battery <= policy.criticalBatteryPercent;
  if (outsideTemperature || outsideHumidity || criticallyLowBattery) return "amber";
  if (
    (hasTemperaturePolicy && telemetry.temperature !== null) ||
    (hasHumidityPolicy && telemetry.humidity !== null)
  )
    return "green";
  return "unknown";
}

function formatReadingTime(value) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

const CONNECTION_PRESENTATION = {
  idle: { label: "Disconnected", icon: WifiOff, style: "border-border bg-surface text-text-muted" },
  connecting: {
    label: "Connecting",
    icon: Clock3,
    style: "border-accent/30 bg-accent/10 text-accent",
  },
  connected: {
    label: "Connected",
    icon: Wifi,
    style: "border-primary/30 bg-primary-glow text-primary",
  },
  reconnecting: {
    label: "Reconnecting",
    icon: WifiOff,
    style: "border-warning/30 bg-warning/10 text-warning",
  },
};

function App() {
  const accessToken = useFieldOperatorStore((state) => state.accessToken);
  const role = useFieldOperatorStore((state) => state.role);
  const selectedShipmentId = useFieldOperatorStore((state) => state.selectedShipmentId);
  const shipments = useFieldOperatorStore((state) => state.shipments);
  const shipmentLoadStatus = useFieldOperatorStore((state) => state.shipmentLoadStatus);
  const connectionStatus = useFieldOperatorStore((state) => state.connectionStatus);
  const reconnectAttempt = useFieldOperatorStore((state) => state.reconnectAttempt);
  const connectionError = useFieldOperatorStore((state) => state.connectionError);
  const simulationClock = useFieldOperatorStore((state) => state.simulationClock);
  const telemetry = useFieldOperatorStore((state) => state.telemetry);
  const readingHistory = useFieldOperatorStore((state) => state.readingHistory);
  const progress = useFieldOperatorStore((state) => state.progress);
  const coldChainStatus = useFieldOperatorStore((state) => state.coldChainStatus);
  const initMessage = useFieldOperatorStore((state) => state.initMessage);
  const [simulatorRouteState, setSimulatorRouteState] = useState({
    status: "idle",
    points: [],
    running: null,
  });
  const selectedShipment =
    shipments.find((shipment) => shipment.shipmentId === selectedShipmentId) || null;
  const selectedShipmentIsAvailable = shipmentLoadStatus === "ready" && Boolean(selectedShipment);

  const restTelemetry = useMemo(
    () => normalizeRestTelemetry(selectedShipment?.latestTelemetry),
    [selectedShipment],
  );
  const displayedTelemetry = telemetry || restTelemetry;
  const policy = useMemo(
    () => resolvePolicy(selectedShipment, initMessage),
    [initMessage, selectedShipment],
  );
  const serverRouteInfo = initMessage?.routeInfo || {};
  const serverRoutePoints = useMemo(() => routePointsFromInit(serverRouteInfo), [serverRouteInfo]);
  const simulatorRoutePoints = simulatorRouteState.points;
  const routePoints = serverRoutePoints.length ? serverRoutePoints : simulatorRoutePoints;
  const routeSource = serverRoutePoints.length
    ? "backend"
    : simulatorRoutePoints.length
      ? "simulator"
      : "unavailable";
  const normalizedCurrentLocation = normalizeCoordinate({
    latitude: displayedTelemetry?.gpsLat,
    longitude: displayedTelemetry?.gpsLng,
  });
  const totalDistanceKm = finite(serverRouteInfo.totalDistanceKm) ?? routeDistanceKm(routePoints);
  const currentProgress = finite(progress ?? displayedTelemetry?.progress);
  const historyForSpeed = readingHistory.length
    ? readingHistory
    : displayedTelemetry
      ? [displayedTelemetry]
      : [];
  const speedKph = finite(displayedTelemetry?.speed) ?? simulatedSpeedKph(historyForSpeed);
  const remainingDistanceKm =
    totalDistanceKm !== null && currentProgress !== null
      ? Math.max(0, totalDistanceKm * (1 - Math.min(100, Math.max(0, currentProgress)) / 100))
      : null;
  const eta = etaMinutes(totalDistanceKm, currentProgress, speedKph);
  const statusColor = resolveStatusColor(
    coldChainStatus,
    displayedTelemetry,
    policy,
    selectedShipment,
  );
  const isQuarantined = statusColor === "red";
  const isMoving = isQuarantined
    ? false
    : simulatorRouteState.running !== null
      ? simulatorRouteState.running
      : speedKph !== null && speedKph > 0.5;
  const hasRouteCoordinates = routePoints.length >= 2;
  const originLabel =
    serverRouteInfo.origin ||
    selectedShipment?.source ||
    (hasRouteCoordinates ? "Configured route start" : "Origin unavailable");
  const destinationLabel =
    serverRouteInfo.destination ||
    selectedShipment?.destination ||
    (hasRouteCoordinates ? "Configured route destination" : "Destination unavailable");
  const weatherState = ["clear", "heat", "rain", "cold"].includes(
    serverRouteInfo.weatherState || initMessage?.currentState?.weatherState,
  )
    ? serverRouteInfo.weatherState || initMessage.currentState.weatherState
    : "clear";

  useEffect(() => {
    if (!accessToken || !selectedShipmentIsAvailable || !["admin", "manufacturer"].includes(role)) {
      setSimulatorRouteState({ status: "unavailable", points: [], running: null });
      return undefined;
    }

    const controller = new AbortController();
    setSimulatorRouteState({ status: "loading", points: [], running: null });
    getSimulatorRoutes(accessToken, { signal: controller.signal })
      .then((simulations) => {
        if (controller.signal.aborted) return;
        const matchingDevice = simulations.find(
          (simulation) => simulation.shipmentId === selectedShipmentId,
        );
        const points = normalizeRoutePoints(matchingDevice?.route || matchingDevice?.config?.route);
        setSimulatorRouteState({
          status: points.length ? "ready" : "empty",
          points,
          running: typeof matchingDevice?.running === "boolean" ? matchingDevice.running : null,
          deviceId: matchingDevice?.deviceId || null,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSimulatorRouteState({
          status: "error",
          points: [],
          running: null,
          error: error.message,
        });
      });

    return () => controller.abort();
  }, [accessToken, role, selectedShipmentId, selectedShipmentIsAvailable]);

  useFieldOperatorSocket({
    shipmentId: selectedShipmentIsAvailable ? selectedShipmentId : "",
    accessToken,
  });

  const connection = CONNECTION_PRESENTATION[connectionStatus] || CONNECTION_PRESENTATION.idle;
  const ConnectionIcon = connection.icon;
  const overviewMessage = !accessToken
    ? "Sign in to load shipments scoped to your role."
    : !selectedShipmentIsAvailable
      ? "Choose an accessible in-transit shipment to start its live connection."
      : connectionStatus === "connected"
        ? "Shipment selected. Live simulated telemetry is connected."
        : connectionStatus === "reconnecting"
          ? `Live connection interrupted. Reconnecting (attempt ${reconnectAttempt})…`
          : "Shipment selected. Waiting for the backend live connection.";

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <header className="fixed inset-x-0 top-0 z-20 h-16 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-full max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-input border border-primary/30 bg-primary-glow p-2 text-primary">
              <Snowflake aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold tracking-[0.12em] text-text-primary sm:text-sm">
                FIELD OPERATOR PANEL
              </p>
              <p className="hidden text-xs text-text-muted sm:block">Cold-chain shipment monitor</p>
            </div>
          </div>

          <div className="hidden min-w-0 flex-1 justify-center px-4 md:flex">
            <span className="operator-mono max-w-64 truncate rounded-input border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
              Shipment: {selectedShipmentId || "not selected"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-xs sm:px-3 ${connection.style}`}
              aria-live="polite"
            >
              <ConnectionIcon aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{connection.label}</span>
            </span>
            <span className="hidden items-center gap-1.5 text-xs text-text-muted lg:inline-flex">
              <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="max-w-40 truncate">{simulationClock || "Clock unavailable"}</span>
            </span>
            <span className="rounded-pill border border-accent/30 bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-accent sm:text-xs">
              Simulated
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-10 pt-24 sm:px-6 lg:px-8">
        <div className="mb-7 flex flex-col justify-between gap-3 border-b border-border pb-6 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Field operations
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Shipment overview
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
              Select an in-transit shipment to establish its simulated cold-chain monitoring
              session.
            </p>
          </div>
          <span
            className={`w-fit rounded-pill border px-3 py-1.5 text-xs font-medium ${connection.style}`}
          >
            {connection.label}
          </span>
        </div>

        <ShipmentAccessPanel />
        {connectionError && selectedShipmentIsAvailable && (
          <p
            className="-mt-3 mb-6 rounded-input border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
            role="status"
          >
            {connectionError}
          </p>
        )}
        {selectedShipmentIsAvailable && connectionStatus !== "connected" && (
          <p className="-mt-3 mb-6 text-xs text-text-muted" role="status">
            {overviewMessage}
          </p>
        )}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <section
            aria-labelledby="section-01"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-12"
          >
            <SectionHeading
              {...sections[0]}
              state={displayedTelemetry ? "Telemetry loaded" : "Waiting for telemetry"}
            />
            <TruckRoadScene
              statusColor={statusColor}
              temperature={displayedTelemetry?.temperature}
              humidity={displayedTelemetry?.humidity}
              speed={speedKph ?? 0}
              isMoving={isMoving && speedKph !== null && speedKph > 0}
              isQuarantined={isQuarantined}
              progress={currentProgress ?? 0}
              weatherState={weatherState}
              totalDistanceKm={totalDistanceKm}
              originLabel={originLabel}
              destinationLabel={destinationLabel}
              etaLabel={formatEta(eta)}
            />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Shipment", selectedShipment?.shipmentId],
                ["Batch", selectedShipment?.batchId],
                ["Vehicle", displayedTelemetry?.vehicleId || simulatorRouteState.deviceId],
                [
                  "Route progress",
                  currentProgress === null ? null : `${currentProgress.toFixed(0)}%`,
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-input border border-border bg-background/60 px-3 py-2.5"
                >
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
                  <p
                    className="operator-mono mt-1 truncate text-xs text-text-primary"
                    title={value || "Unavailable"}
                  >
                    {value || "Unavailable"}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="section-02"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-12"
          >
            <SectionHeading
              {...sections[1]}
              state={displayedTelemetry ? "Latest sample" : "No sample yet"}
            />
            <Suspense
              fallback={<Placeholder className="min-h-40">Loading sensor gauges…</Placeholder>}
            >
              <TelemetryGauges telemetry={displayedTelemetry} policy={policy} />
            </Suspense>
            <div className="mt-4 flex flex-col gap-2 rounded-input border border-border bg-background/60 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
              <p className="text-text-secondary">
                {policy.approvedAt
                  ? `Batch policy provided${policy.sourceReference ? ` · ${policy.sourceReference}` : ""}`
                  : "No approved batch policy was returned; gauges do not imply a safe range."}
              </p>
              <p
                className="operator-mono text-text-muted"
                title={displayedTelemetry?.simulationClock || ""}
              >
                Last sample: {formatReadingTime(displayedTelemetry?.simulationClock)}
              </p>
            </div>
          </section>

          <section
            aria-labelledby="section-03"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-12"
          >
            <SectionHeading
              {...sections[2]}
              state={
                routePoints.length
                  ? "Route loaded"
                  : normalizedCurrentLocation
                    ? "GPS received"
                    : "Waiting for GPS"
              }
            />
            <Suspense
              fallback={
                <Placeholder className="min-h-[240px] sm:min-h-[320px]">
                  Loading simulated route map…
                </Placeholder>
              }
            >
              <ShipmentMap
                currentLocation={normalizedCurrentLocation}
                routePoints={routePoints}
                routeSource={routeSource}
                statusColor={statusColor}
                originLabel={originLabel}
                destinationLabel={destinationLabel}
              />
            </Suspense>
            {simulatorRouteState.status === "error" && ["admin", "manufacturer"].includes(role) && (
              <p
                className="mt-3 rounded-input border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
                role="status"
              >
                Configured simulator route could not be loaded: {simulatorRouteState.error}
              </p>
            )}
            <div className="mt-3 flex flex-col gap-1 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
              <span>
                Current GPS:{" "}
                {normalizedCurrentLocation
                  ? formatCoordinate(normalizedCurrentLocation)
                  : "Unavailable"}
              </span>
              <span>GPS timestamp: {formatReadingTime(displayedTelemetry?.simulationClock)}</span>
            </div>
          </section>

          <section
            aria-labelledby="section-04"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-5"
          >
            <SectionHeading
              {...sections[3]}
              state={totalDistanceKm !== null ? "Route estimate" : "Route unavailable"}
            />
            <div className="rounded-input border border-border bg-background/60 px-4">
              <RouteDatum label="Origin" value={originLabel} />
              <RouteDatum label="Destination" value={destinationLabel} />
              <div className="grid grid-cols-2 gap-4">
                <RouteDatum
                  label="Distance remaining"
                  value={
                    remainingDistanceKm === null
                      ? "Unavailable"
                      : `${remainingDistanceKm.toFixed(1)} km`
                  }
                />
                <RouteDatum label="Estimated arrival" value={formatEta(eta)} />
                <RouteDatum
                  label="Total route distance"
                  value={
                    totalDistanceKm === null ? "Unavailable" : `${totalDistanceKm.toFixed(1)} km`
                  }
                />
                <RouteDatum
                  label="Simulated speed"
                  value={speedKph === null ? "Unavailable" : `${speedKph.toFixed(1)} km/h`}
                />
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-text-muted" role="note">
              Estimated from simulated GPS timestamps and reported workflow progress; not live
              vehicle speed. ETA appears only when route distance, progress, and at least two timed
              GPS samples are available.
            </p>
          </section>

          <section
            aria-labelledby="section-05"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-7"
          >
            <SectionHeading {...sections[4]} />
            <div className="rounded-input border border-warning/30 bg-warning/5 p-4">
              <p className="text-sm font-medium text-warning">No manual changes are active</p>
              <p className="mt-2 text-xs leading-5 text-text-secondary">
                This panel will request simulator changes through the backend policy workflow. It
                will not directly create or clear a safety alert.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {["Temperature target", "Humidity target", "Operator", "Last change"].map((label) => (
                <div
                  key={label}
                  className="rounded-input border border-border bg-background/60 px-3 py-3"
                >
                  <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
                  <p className="operator-mono mt-2 text-xs text-text-muted">
                    Available in a later step
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="section-06"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-12"
          >
            <SectionHeading {...sections[5]} />
            <div className="flex items-start gap-3 rounded-input border border-border bg-background/60 p-4">
              <Bell aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              <div>
                <p className="text-sm font-medium text-text-secondary">No alert data available</p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  This empty state means no readings have been loaded; it does not indicate that a
                  shipment is within limits.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Open", "Acknowledged", "Resolved"].map((status) => (
                <span
                  key={status}
                  className="rounded-pill border border-border px-3 py-1 text-xs text-text-muted"
                >
                  {status}: —
                </span>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="section-07"
            className="operator-panel-surface p-5 sm:p-6 xl:col-span-12"
          >
            <SectionHeading {...sections[6]} />
            <div className="grid gap-4 lg:grid-cols-2">
              {[
                { label: "Temperature history", unit: "°C", icon: Thermometer },
                { label: "Humidity history", unit: "% RH", icon: Droplets },
              ].map(({ label, unit, icon: Icon }) => (
                <div
                  key={label}
                  className="rounded-input border border-border bg-background/60 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                      <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
                      {label}
                    </div>
                    <span className="operator-mono text-xs text-text-muted">{unit}</span>
                  </div>
                  <Placeholder className="min-h-32">No sensor history to chart yet.</Placeholder>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-text-muted">
              Approved policy thresholds and event markers will be added when real simulator history
              is connected.
            </p>
          </section>
        </div>

        <footer className="mt-8 flex flex-col gap-2 border-t border-border pt-5 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            Vaccine supply chain · Software demo · Synthetic data only · Not for clinical or
            production use
          </p>
          <p className="operator-mono">Field Operator Panel · v0.1.0</p>
        </footer>
      </main>
    </div>
  );
}

export default App;
