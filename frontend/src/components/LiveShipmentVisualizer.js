import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, AlertTriangle, ArrowRight, MapPin, RefreshCw } from "lucide-react";
import { fetchTemperatureAlerts } from "../services/alerts";
import { fetchLiveShipments } from "../services/liveShipments";
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

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;
    const update = event => setReduced(event.matches);
    query.addEventListener?.("change", update);
    query.addListener?.(update);
    return () => {
      query.removeEventListener?.("change", update);
      query.removeListener?.(update);
    };
  }, []);
  return reduced;
}

function policyText(shipment) {
  if (!shipment.policy) return "Approved limits unavailable";
  const temperature = `${shipment.policy.minimumTemperature}–${shipment.policy.maximumTemperature}°C`;
  const humidity = shipment.policy.minimumHumidity != null && shipment.policy.maximumHumidity != null
    ? ` · ${shipment.policy.minimumHumidity}–${shipment.policy.maximumHumidity}% RH` : " · humidity limits not set";
  return `Policy ${temperature}${humidity}`;
}

function Gauge({ label, value, minimum, maximum, unit, scaleMin, scaleMax }) {
  if (value == null) return <span className="live-shipment__gauge">{label}: no reading</span>;
  const low = minimum == null ? scaleMin : Number(minimum);
  const high = maximum == null ? scaleMax : Number(maximum);
  const start = Math.max(0, Math.min(100, (low - scaleMin) / (scaleMax - scaleMin) * 100));
  const width = Math.max(0, Math.min(100 - start, (high - low) / (scaleMax - scaleMin) * 100));
  const position = Math.max(0, Math.min(100, (Number(value) - scaleMin) / (scaleMax - scaleMin) * 100));
  return <span className="live-shipment__gauge" aria-label={`${label} ${value}${unit}; configured range ${minimum ?? "not set"} to ${maximum ?? "not set"}${unit}`}>
    <span className="live-shipment__gauge-label">{label}</span>
    <strong>{Number(value).toFixed(1)}{unit}</strong>
    <span className="live-shipment__gauge-track" aria-hidden="true">
      <span className="live-shipment__gauge-band" style={{ left: `${start}%`, width: `${width}%` }} />
      <span className="live-shipment__gauge-marker" style={{ left: `${position}%` }} />
    </span>
    <span className="live-shipment__gauge-range">{minimum == null || maximum == null ? "No approved range" : `${minimum}–${maximum}${unit}`}</span>
  </span>;
}

function TruckScene({ shipment, progress, stopped }) {
  const reading = shipment.latestTelemetry || {};
  const policy = shipment.policy || {};
  const x = 10 + progress * 4.7;
  const location = reading.location || {};
  const latitude = location.lat ?? location.latitude;
  const longitude = location.lng ?? location.longitude;
  return <div className="live-shipment__scene">
    <svg className="live-shipment__svg" viewBox="0 0 720 180" role="img" aria-label={`Simulated shipment truck, ${progress}% through persisted shipment workflow${stopped ? ", stationary" : ""}`}>
      <path className="live-shipment__ground" d="M0 136H720" />
      <path className="live-shipment__road" d="M0 138H720" />
      <path className="live-shipment__road-line" d="M0 138H720" />
      <path className="live-shipment__route-track" d="M18 138H645" />
      <circle className="live-shipment__destination" cx="650" cy="138" r="9" />
      <text className="live-shipment__destination-label" x="635" y="166">DESTINATION</text>
      <g className="live-shipment__truck" style={{ transform: `translateX(${x}px)` }}>
        <rect className="live-shipment__cargo" x="0" y="53" width="142" height="67" rx="9" />
        <rect className="live-shipment__cab" x="145" y="72" width="54" height="48" rx="7" />
        <path className="live-shipment__window" d="M155 78h29v18h-29z" />
        <circle className="live-shipment__wheel" cx="42" cy="124" r="13" />
        <circle className="live-shipment__wheel" cx="166" cy="124" r="13" />
        <circle className="live-shipment__wheel-inner" cx="42" cy="124" r="5" />
        <circle className="live-shipment__wheel-inner" cx="166" cy="124" r="5" />
        <circle className="live-shipment__status-light" cx="127" cy="63" r="7" />
        <text className="live-shipment__truck-label" x="13" y="74">COLD-CHAIN LOAD</text>
        <foreignObject x="12" y="81" width="119" height="34">
          <div xmlns="http://www.w3.org/1999/xhtml" className="live-shipment__gauges">
            <Gauge label="TEMP" value={reading.temperature} minimum={policy.minimumTemperature} maximum={policy.maximumTemperature} unit="°C" scaleMin={-40} scaleMax={60} />
            <Gauge label="RH" value={reading.humidity} minimum={policy.minimumHumidity} maximum={policy.maximumHumidity} unit="%" scaleMin={0} scaleMax={100} />
          </div>
        </foreignObject>
      </g>
    </svg>
    <div className="live-shipment__scene-foot">
      <span>{stopped ? "Truck stationary" : `Workflow progress ${progress}%`}</span>
      {latitude != null && longitude != null
        ? <span><MapPin aria-hidden="true" size={13} /> Simulated GPS {Number(latitude).toFixed(4)}, {Number(longitude).toFixed(4)}</span>
        : <span>Location not recorded</span>}
    </div>
  </div>;
}

function ShipmentCard({ shipment, alert, compact }) {
  const quarantined = shipmentIsQuarantined(shipment, alert ? [alert] : []);
  const stopped = shipmentIsStopped(shipment, quarantined);
  const tone = shipmentTone(shipment, alert ? [alert] : []);
  const activeAlert = Boolean(alert && alert.phase !== "CLEARED" && alert.responseState !== "RESOLVED" && alert.status !== "RESOLVED");
  const progress = shipmentProgress(shipment);
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

    <Link className="live-shipment__scene-link" to={href} aria-label={`Open ${shipment.shipmentId} shipment alerts and details`}>
      <TruckScene shipment={shipment} progress={progress} stopped={stopped} />
    </Link>

    <div className="live-shipment__readings" aria-label={`Latest saved sensor reading for ${shipment.shipmentId}`}>
      <span><strong>{reading.temperature == null ? "—" : `${Number(reading.temperature).toFixed(1)}°C`}</strong> Temperature</span>
      <span><strong>{reading.humidity == null ? "—" : `${Number(reading.humidity).toFixed(1)}%`}</strong> Humidity</span>
      <span><strong>{reading.batteryLevel == null ? "—" : `${Number(reading.batteryLevel).toFixed(1)}%`}</strong> Battery</span>
      <span className="live-shipment__policy">{policyText(shipment)}</span>
    </div>
    <p className="live-shipment__timestamp">{reading.recordedAt ? `Last saved reading ${new Date(reading.recordedAt).toLocaleString()}` : "No shipment-linked reading saved yet"}</p>

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
  const [shipments, setShipments] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [alertError, setAlertError] = useState("");
  const [visibleCount, setVisibleCount] = useState(maxVisible);
  const prefersReducedMotion = usePrefersReducedMotion();

  const refresh = useCallback(async () => {
    if (!localStorage.getItem("token")) {
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
    const timer = window.setInterval(() => { if (active) safeRefresh(); }, REFRESH_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") safeRefresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => setVisibleCount(maxVisible), [maxVisible, shipmentId]);

  const cards = useMemo(() => shipments.map(shipment => {
    const sameBatchCount = shipments.filter(item => item.batchId === shipment.batchId).length;
    return { shipment, alert: alertForShipment(shipment, alerts, sameBatchCount) };
  }), [shipments, alerts]);
  const shown = cards.slice(0, visibleCount);

  return <section className={`live-shipment ${compact ? "live-shipment--compact" : ""}`} data-reduced-motion={prefersReducedMotion ? "true" : "false"} aria-label="Simulated live shipment visualizer">
    <header className="live-shipment__header">
      <div><div className="live-shipment__eyebrow"><Activity aria-hidden="true" size={14} /> SOFTWARE-ONLY TRACKING</div><h2>{title}</h2>
        <p>Position reflects saved shipment workflow status—not a moving vehicle or live GPS feed.</p></div>
      <div className="live-shipment__header-actions">
        <span className="live-shipment__simulated"><span aria-hidden="true" className="live-shipment__simulated-dot" />Simulated</span>
        <button type="button" className="live-shipment__refresh" onClick={() => { setLoading(true); refresh(); }} aria-label="Refresh live shipments"><RefreshCw aria-hidden="true" size={15} /> Refresh</button>
        {compact ? <Link className="live-shipment__details-link" to="/live-shipments">View all <ArrowRight aria-hidden="true" size={15} /></Link> : null}
      </div>
    </header>

    {loadError ? <p role="status" className="live-shipment__error">{loadError}</p> : null}
    {alertError ? <p role="status" className="live-shipment__subtle-error">{alertError}</p> : null}
    {loading && !shipments.length ? <p role="status" className="live-shipment__empty">Loading role-visible shipment and telemetry records…</p> : null}
    {!loading && !loadError && !cards.length ? <p className="live-shipment__empty">No shipment records are available for this account.</p> : null}

    <div className="live-shipment__list">{shown.map(({ shipment, alert }) => <ShipmentCard key={shipment.shipmentId} shipment={shipment} alert={alert} compact={compact} />)}</div>
    {cards.length > visibleCount ? <button type="button" className="live-shipment__show-more" onClick={() => setVisibleCount(value => Math.min(cards.length, value + maxVisible))}>Show {Math.min(maxVisible, cards.length - visibleCount)} more of {cards.length} shipments</button> : null}
    <p className="live-shipment__disclaimer">For demonstration only. Policy limits are displayed only when an approved batch policy is linked; this visualization is not a vaccine-safety determination.</p>
  </section>;
}
