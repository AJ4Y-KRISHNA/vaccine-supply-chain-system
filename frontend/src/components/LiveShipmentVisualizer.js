import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { fetchTemperatureAlerts } from "../services/alerts";
import { fetchBatchLocationHistory, fetchLiveShipments, fetchShipmentTemperatureHistory } from "../services/liveShipments";
import ShipmentLocationMap from "./ShipmentLocationMap";
import TelemetryHistoryChart from "./TelemetryHistoryChart";
import useDashboardRealtime from "../hooks/useDashboardRealtime";
import "./LiveShipmentVisualizer.css";

const REFRESH_MS = 8000;
const TERMINAL = /deliver|confirm|cancel|complete|closed/i;

export function shipmentProgress(shipment = {}) {
  const histories = Array.isArray(shipment.statusHistory) ? shipment.statusHistory : [];
  const statuses = [shipment.status, ...histories.map(item => item.status)].filter(Boolean).join(" ").toLowerCase();
  if (/deliver|confirm|complete/.test(statuses) || shipment.hospitalConfirmed) return 100;
  if (/in transit|dispatched/.test(statuses)) return 58;
  if (/supplied|vaccination center|vaccination centre/.test(statuses)) return 82;
  if (/verified|approved/.test(statuses)) return 28;
  if (/pending dispatch|ready/.test(statuses)) return 16;
  if (/pending|created/.test(statuses)) return 6;
  return 0;
}

export function shipmentIsQuarantined(shipment = {}, alerts = []) {
  const held = [shipment.coldChainStatus, shipment.batchColdChainStatus].some(value => /quarantin|hold/i.test(String(value || "")))
    || Boolean(shipment.coldChainHoldAlertIds?.length || shipment.batchColdChainHoldAlertIds?.length);
  return held || alerts.some(alert => alert.requiresQualityReview && alert.phase !== "CLEARED");
}

export function shipmentIsStopped(shipment = {}, quarantined = shipmentIsQuarantined(shipment)) {
  const status = `${shipment.status || ""} ${shipment.batchDisposition?.status || ""}`;
  return quarantined || TERMINAL.test(status) || shipment.hospitalConfirmed === true;
}

function isOutside(value, minimum, maximum) {
  return value != null && minimum != null && maximum != null
    && (Number(value) < Number(minimum) || Number(value) > Number(maximum));
}

export function shipmentTone(shipment = {}, alerts = []) {
  if (shipmentIsQuarantined(shipment, alerts)) return "critical";
  const reading = shipment.latestTelemetry;
  const policy = shipment.policy;
  if (!reading || !policy) return "unknown";
  const outOfPolicy = isOutside(reading.temperature, policy.minimumTemperature, policy.maximumTemperature)
    || isOutside(reading.humidity, policy.minimumHumidity, policy.maximumHumidity);
  const lowBattery = reading.batteryLevel != null && policy.criticalBatteryPercent != null
    && Number(reading.batteryLevel) <= Number(policy.criticalBatteryPercent);
  const unresolvedAlert = alerts.some(alert => !["CLEARED", "RESOLVED"].includes(alert.phase)
    && alert.responseState !== "RESOLVED" && alert.status !== "RESOLVED");
  if (outOfPolicy || lowBattery || unresolvedAlert) return "warning";
  return "normal";
}

function alertForShipment(shipment, alerts, sameBatchCount) {
  const candidates = alerts.filter(alert => alert.shipmentId === shipment.shipmentId
    || (!alert.shipmentId && sameBatchCount === 1 && alert.batchId === shipment.batchId));
  return candidates.sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0))[0] || null;
}

function policyText(shipment) {
  if (!shipment.policy) return "Approved limits unavailable";
  const temperature = `${shipment.policy.minimumTemperature}–${shipment.policy.maximumTemperature}°C`;
  const humidity = shipment.policy.minimumHumidity != null && shipment.policy.maximumHumidity != null
    ? ` · ${shipment.policy.minimumHumidity}–${shipment.policy.maximumHumidity}% RH` : " · humidity limits not set";
  return `Policy ${temperature}${humidity}`;
}

function ShipmentCard({ shipment, alert, compact, locationHistory, sensorHistory }) {
  const quarantined = shipmentIsQuarantined(shipment, alert ? [alert] : []);
  const stopped = shipmentIsStopped(shipment, quarantined);
  const tone = shipmentTone(shipment, alert ? [alert] : []);
  const activeAlert = Boolean(alert && alert.phase !== "CLEARED" && alert.responseState !== "RESOLVED" && alert.status !== "RESOLVED");
  const reading = shipment.latestTelemetry || {};
  const href = `/live-shipments?shipmentId=${encodeURIComponent(shipment.shipmentId)}`;
  const stateLabel = quarantined ? "Quarantined — pending review"
    : stopped ? (shipment.hospitalConfirmed || /deliver|confirm/i.test(shipment.status || "") ? "Delivered" : shipment.status || "Stopped")
      : tone === "warning" ? "Excursion / review" : tone === "normal" ? "Within recorded policy range" : "Awaiting policy or telemetry";

  return <article className={`live-shipment__card live-shipment--${tone}${activeAlert ? " live-shipment--alert-active" : ""}`} aria-label={`Shipment ${shipment.shipmentId}: ${stateLabel}`}>
    <div className="live-shipment__card-header">
      <div className="live-shipment__heading">
        <span className="live-shipment__simulated">Simulated</span>
        <h3>{shipment.shipmentId}</h3>
        <p>{shipment.batchId || "Batch not recorded"} · {shipment.destination || "Destination not recorded"}</p>
      </div>
      <span className={`live-shipment__state live-shipment__state--${tone}`}><span className="live-shipment__state-dot" />{stateLabel}</span>
    </div>

    <div className="live-shipment__map-wrap">
      {locationHistory?.loading ? <p className="live-shipment__map-status" role="status">Loading saved GPS history…</p> : null}
      {locationHistory?.error ? <p className="live-shipment__map-status live-shipment__map-status--error" role="status">Saved GPS history is temporarily unavailable.</p> : null}
      <ShipmentLocationMap
        shipmentId={shipment.shipmentId}
        destination={shipment.destination}
        points={locationHistory?.points || []}
        currentLocation={reading.location ? { ...reading.location, recordedAt: reading.recordedAt } : null}
        compact={compact}
        statusColor={tone === "critical" ? "red" : tone === "warning" ? "amber" : tone === "normal" ? "green" : "unknown"}
      />
    </div>

    <div className="live-shipment__readings" aria-label={`Latest saved sensor reading for ${shipment.shipmentId}`}>
      <span><strong>{reading.temperature == null ? "—" : `${Number(reading.temperature).toFixed(1)}°C`}</strong> Temperature</span>
      <span><strong>{reading.humidity == null ? "—" : `${Number(reading.humidity).toFixed(1)}%`}</strong> Humidity</span>
      <span><strong>{reading.batteryLevel == null ? "—" : `${Number(reading.batteryLevel).toFixed(1)}%`}</strong> Battery</span>
      <span className="live-shipment__policy">{policyText(shipment)}</span>
    </div>
    <p className="live-shipment__timestamp">{reading.recordedAt ? `Last saved reading ${new Date(reading.recordedAt).toLocaleString()}` : "No shipment-linked reading saved yet"}</p>
    <TelemetryHistoryChart records={sensorHistory || []} policy={shipment.policy || {}} shipmentId={shipment.shipmentId} />

    {alert ? <details className={`live-shipment__alert ${alert.requiresQualityReview && alert.phase !== "CLEARED" ? "live-shipment__alert--critical" : ""}`} open={!compact}>
      <summary><AlertTriangle aria-hidden="true" size={15} /> Latest related event: {alert.severity || "NOTICE"} · {alert.phase || alert.responseState || alert.status || "OPEN"}</summary>
      <p>{alert.reason || alert.reasons?.join("; ") || "Review the linked cold-chain alert."}</p>
      <p><strong>Recommended action:</strong> {alert.recommendedAction || "Review the cold-chain event"}</p>
    </details> : null}

    <div className="live-shipment__card-footer">
      <span>{shipment.latestTelemetry?.deviceId ? `Device ${shipment.latestTelemetry.deviceId}` : "No linked sensor ID"}</span>
      <Link to={href} className="live-shipment__details-link">Open shipment details <ArrowRight aria-hidden="true" size={15} /></Link>
    </div>
  </article>;
}

export default function LiveShipmentVisualizer({
  compact = false,
  shipmentId = "",
  maxVisible = 5,
  title = "Live shipment visualizer",
}) {
  const realtime = useDashboardRealtime();
  const [shipments, setShipments] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [alertError, setAlertError] = useState("");
  const [locationHistories, setLocationHistories] = useState({});
  const [sensorHistories, setSensorHistories] = useState({});
  const [visibleCount, setVisibleCount] = useState(maxVisible);

  const refresh = useCallback(async () => {
    if (!sessionStorage.getItem("token")) {
      setLoading(false);
      setLoadError("Sign in to view live shipment records.");
      return;
    }
    const [shipmentsResult, alertsResult] = await Promise.allSettled([
      fetchLiveShipments({ shipmentId: shipmentId || undefined, limit: shipmentId ? 1 : 100 }),
      fetchTemperatureAlerts({ limit: 200 }),
    ]);
    if (shipmentsResult.status === "fulfilled") {
      setShipments(shipmentsResult.value.shipments || []);
      setLoadError("");
    } else {
      setLoadError(shipmentsResult.reason?.response?.data?.error || shipmentsResult.reason?.message || "Shipment data could not be loaded.");
    }
    if (alertsResult.status === "fulfilled") {
      setAlerts(alertsResult.value.alerts || []);
      setAlertError("");
    } else {
      setAlerts([]);
      setAlertError("Alert details are temporarily unavailable.");
    }
    setLoading(false);
  }, [shipmentId]);

  useEffect(() => {
    let active = true;
    const safeRefresh = async () => {
      if (document.visibilityState === "hidden") return;
      await refresh();
    };
    setLoading(true);
    safeRefresh();
    const timer = realtime.status === "live" ? null : window.setInterval(() => { if (active) safeRefresh(); }, REFRESH_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") safeRefresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, realtime.status]);

  useEffect(() => {
    if (!realtime.event) return;
    refresh();
  }, [realtime.event, refresh]);

  useEffect(() => setVisibleCount(maxVisible), [maxVisible, shipmentId]);

  useEffect(() => {
    let active = true;
    const visibleShipments = shipments.slice(0, visibleCount);
    const batchIds = [...new Set(visibleShipments.map(item => item.batchId).filter(Boolean))];
    if (!batchIds.length) {
      setLocationHistories({});
      return () => { active = false; };
    }
    setLocationHistories(previous => Object.fromEntries(visibleShipments.map(item => [item.shipmentId, {
      ...(previous[item.shipmentId] || {}), loading: true, error: false,
    }])));
    Promise.all(batchIds.map(async batchId => {
      try {
        const result = await fetchBatchLocationHistory(batchId, { limit: 500 });
        return [batchId, Array.isArray(result.points) ? result.points : [], false];
      } catch {
        return [batchId, [], true];
      }
    })).then(results => {
      if (!active) return;
      const byBatchId = new Map(results.map(([batchId, points, error]) => [batchId, { points, error }]));
      const sameBatchCounts = new Map();
      shipments.forEach(item => sameBatchCounts.set(item.batchId, (sameBatchCounts.get(item.batchId) || 0) + 1));
      setLocationHistories(Object.fromEntries(visibleShipments.map(item => {
        const history = byBatchId.get(item.batchId) || { points: [], error: false };
        const points = history.points.filter(point => point.shipmentId === item.shipmentId
          || (!point.shipmentId && sameBatchCounts.get(item.batchId) === 1));
        return [item.shipmentId, { points, error: history.error, loading: false }];
      })));
    });
    return () => { active = false; };
  }, [shipments, visibleCount]);

  useEffect(() => {
    let active = true;
    const visible = shipments.slice(0, visibleCount);
    Promise.all(visible.map(async shipment => {
      try {
        const result = await fetchShipmentTemperatureHistory(shipment.shipmentId, { limit: 500, latest: true });
        return [shipment.shipmentId, result.records || []];
      } catch { return [shipment.shipmentId, []]; }
    })).then(entries => { if (active) setSensorHistories(previous => ({ ...previous, ...Object.fromEntries(entries) })); });
    return () => { active = false; };
  }, [shipments, visibleCount]);

  const cards = useMemo(() => shipments.map(shipment => {
    const sameBatchCount = shipments.filter(item => item.batchId === shipment.batchId).length;
    return { shipment, alert: alertForShipment(shipment, alerts, sameBatchCount) };
  }), [shipments, alerts]);
  const shown = cards.slice(0, visibleCount);

  return <section id="live-shipment-visualizer" className={`live-shipment ${compact ? "live-shipment--compact" : ""}`} aria-label="Simulated live shipment visualizer">
    <header className="live-shipment__header">
      <div><div className="live-shipment__eyebrow"><Activity aria-hidden="true" size={14} /> SOFTWARE-ONLY TRACKING</div><h2>{title}</h2>
        <p>Map route uses saved simulated GPS history from sensor readings. It is not live vehicle tracking.</p></div>
      <div className="live-shipment__header-actions">
        <span className="live-shipment__simulated"><span aria-hidden="true" className="live-shipment__simulated-dot" />Simulated</span>
        <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${realtime.status === "live" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`} role="status">{realtime.status === "live" ? "Live" : "Degraded · polling fallback"}</span>
        <button type="button" className="live-shipment__refresh" onClick={() => { setLoading(true); refresh(); }} aria-label="Refresh live shipments"><RefreshCw aria-hidden="true" size={15} /> Refresh</button>
        {compact ? <Link className="live-shipment__details-link" to="/live-shipments">View all <ArrowRight aria-hidden="true" size={15} /></Link> : null}
      </div>
    </header>

    {loadError ? <p role="status" className="live-shipment__error">{loadError}</p> : null}
    {alertError ? <p role="status" className="live-shipment__subtle-error">{alertError}</p> : null}
    {loading && !shipments.length ? <p role="status" className="live-shipment__empty">Loading role-visible shipment and telemetry records…</p> : null}
    {!loading && !loadError && !cards.length ? <p className="live-shipment__empty">No shipment records are available for this account.</p> : null}

    <div className="live-shipment__list">{shown.map(({ shipment, alert }) => <ShipmentCard key={shipment.shipmentId} shipment={shipment} alert={alert} compact={compact} locationHistory={locationHistories[shipment.shipmentId]} sensorHistory={sensorHistories[shipment.shipmentId]} />)}</div>
    {cards.length > visibleCount ? <button type="button" className="live-shipment__show-more" onClick={() => setVisibleCount(value => Math.min(cards.length, value + maxVisible))}>Show {Math.min(maxVisible, cards.length - visibleCount)} more of {cards.length} shipments</button> : null}
    <p className="live-shipment__disclaimer">For demonstration only. Coordinates come from saved simulated sensor readings and OpenStreetMap tiles; policy limits are informational and are not a vaccine-safety determination.</p>
  </section>;
}
