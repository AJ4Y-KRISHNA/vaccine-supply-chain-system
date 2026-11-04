import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import { Activity, Bell, CheckCircle2, Clock3, MapPin, PackageCheck, RefreshCw, ShieldAlert, Thermometer } from "lucide-react";
import { CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip } from "chart.js";
import { fetchBatchJourney, fetchTraceabilityBatches } from "../services/traceability";
import StatusBadge from "./StatusBadge";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const dateText = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : "Time unavailable";
const kinds = ["all", "batch", "disposition", "order", "shipment", "telemetry", "evaluation", "alert", "audit", "policy", "blockchain", "delivery", "administration"];
const iconFor = kind => ({ batch: PackageCheck, order: Activity, shipment: PackageCheck, telemetry: Thermometer,
  alert: ShieldAlert, audit: CheckCircle2, disposition: ShieldAlert, policy: CheckCircle2, blockchain: CheckCircle2,
  evaluation: Activity, delivery: CheckCircle2, administration: Activity }[kind] || Clock3);
const colorFor = kind => ({ alert: "border-amber-300 bg-amber-50 text-amber-900", audit: "border-emerald-200 bg-emerald-50 text-emerald-900",
  disposition: "border-rose-200 bg-rose-50 text-rose-900", policy: "border-emerald-200 bg-emerald-50 text-emerald-900", evaluation: "border-amber-200 bg-amber-50 text-amber-900", blockchain: "border-violet-200 bg-violet-50 text-violet-900",
  telemetry: "border-blue-200 bg-blue-50 text-blue-900", delivery: "border-emerald-200 bg-emerald-50 text-emerald-900",
  administration: "border-violet-200 bg-violet-50 text-violet-900" }[kind] || "border-slate-200 bg-white text-slate-800");

function nearestIndex(readings, time) {
  if (!readings.length || !time) return -1;
  const target = Date.parse(time);
  if (!Number.isFinite(target)) return -1;
  let result = 0;
  for (let i = 1; i < readings.length; i += 1) if (Math.abs(Date.parse(readings[i].recordedAt) - target) < Math.abs(Date.parse(readings[result].recordedAt) - target)) result = i;
  return result;
}

function makeMarkers(readings, alerts, events) {
  const markers = [];
  alerts.forEach(alert => {
    const openIndex = nearestIndex(readings, alert.timestamp || alert.excursionStartedAt);
    if (openIndex >= 0) markers.push({ index: openIndex, value: readings[openIndex].temperature, label: "Alert opened", color: "#d97706", shape: "circle" });
    const quarantine = events.find(event => event.alertId === alert.alertId && /quarantin/i.test(event.title));
    const quarantineIndex = nearestIndex(readings, quarantine?.at);
    if (quarantineIndex >= 0) markers.push({ index: quarantineIndex, value: readings[quarantineIndex].temperature, label: "Quarantine began", color: "#dc2626", shape: "rectRot" });
    const recoveredAt = alert.excursionClosedAt || events.find(event => event.alertId === alert.alertId && /excursion closed|recovered/i.test(event.title))?.at;
    const recoveredIndex = nearestIndex(readings, recoveredAt);
    if (recoveredIndex >= 0) markers.push({ index: recoveredIndex, value: readings[recoveredIndex].temperature, label: "Excursion recovered", color: "#15803d", shape: "triangle" });
  });
  events.filter(event => event.kind === "policy").forEach(event => {
    const index = nearestIndex(readings, event.at);
    if (index >= 0) markers.push({ index, value: readings[index].temperature, label: "Policy approved", color: "#047857", shape: "cross" });
  });
  return markers;
}

export default function TraceabilityPanel() {
  const requestedBatchId = new URLSearchParams(window.location.search).get("batchId") || "";
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState("");
  const [journey, setJourney] = useState(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [error, setError] = useState("");

  const loadBatches = useCallback(async () => {
    setError("");
    setLoadingBatches(true);
    try {
      const result = await fetchTraceabilityBatches();
      const next = result.batches || [];
      setBatches(next);
      if (!batchId && requestedBatchId && next.some(batch => batch.batchId === requestedBatchId)) setBatchId(requestedBatchId);
      else if (!batchId && next.length) setBatchId(next[0].batchId);
      else if (batchId && !next.some(batch => batch.batchId === batchId)) setBatchId(requestedBatchId && next.some(batch => batch.batchId === requestedBatchId) ? requestedBatchId : next[0]?.batchId || "");
    } catch (failure) { setError(failure.response?.data?.error || "Batch list could not be loaded for this account."); }
    finally { setLoadingBatches(false); }
  }, [batchId, requestedBatchId]);

  const loadJourney = useCallback(async () => {
    if (!batchId) { setJourney(null); return; }
    setLoading(true); setError("");
    try { setJourney(await fetchBatchJourney(batchId)); }
    catch (failure) { setJourney(null); setError(failure.response?.data?.error || "Journey records could not be loaded."); }
    finally { setLoading(false); }
  }, [batchId]);

  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { loadJourney(); }, [loadJourney]);

  const filteredEvents = useMemo(() => (journey?.events || []).filter(event => filter === "all" || event.kind === filter), [journey, filter]);
  const chartData = useMemo(() => {
    const readings = journey?.readings || [];
    const labels = readings.map(reading => new Date(reading.recordedAt).toLocaleTimeString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    const policy = journey?.policy;
    const datasets = [{ label: "Temperature °C", data: readings.map(reading => reading.temperature), borderColor: "#15803d", backgroundColor: "#15803d", tension: .22, pointRadius: 3, pointHoverRadius: 5, spanGaps: true }];
    if (policy) {
      datasets.push({ label: "Approved maximum", data: readings.map(() => policy.maximumTemperature), borderColor: "#dc2626", borderDash: [6, 5], borderWidth: 2, pointRadius: 0 });
      datasets.push({ label: "Approved minimum", data: readings.map(() => policy.minimumTemperature), borderColor: "#d97706", borderDash: [6, 5], borderWidth: 2, pointRadius: 0 });
    }
    const markers = makeMarkers(readings, journey?.alerts || [], journey?.events || []);
    const markerTypes = [...new Set(markers.map(marker => marker.label))];
    markerTypes.forEach(label => {
      const group = markers.filter(marker => marker.label === label);
      const byIndex = new Map(group.map(marker => [marker.index, marker]));
      const marker = group[0];
      datasets.push({ label, data: readings.map((_reading, index) => byIndex.get(index)?.value ?? null),
        showLine: false, pointRadius: readings.map((_reading, index) => byIndex.has(index) ? 7 : 0),
        pointHoverRadius: 9, pointStyle: marker.shape, backgroundColor: marker.color, borderColor: "#fff", borderWidth: 1 });
    });
    return { labels, datasets };
  }, [journey]);
  const readings = journey?.readings || [];
  const latest = readings[readings.length - 1];
  const humidityAverage = readings.length ? readings.reduce((sum, reading) => sum + (Number(reading.humidity) || 0), 0) / readings.filter(reading => reading.humidity != null).length : null;
  const lastGps = [...readings].reverse().find(reading => reading.latitude != null && reading.longitude != null);

  return <section aria-label="Batch Story" aria-busy={loading || loadingBatches} className="ui-card my-5 rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
    <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950"><Activity size={19} /> Batch Story</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">A read-only, role-scoped record of the batch journey, sensor history, policy decisions, shipment events and available local-chain references.</p></div>
      <button type="button" onClick={() => { loadBatches(); loadJourney(); }} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-800 disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh</button>
    </header>
    <div className="mb-5 grid gap-3 md:grid-cols-[minmax(240px,1fr)_minmax(150px,220px)]">
      <label className="text-sm font-medium text-slate-700">Batch<select aria-label="Traceability batch" value={batchId} onChange={event => setBatchId(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
        <option value="">Select an available batch</option>{batches.map(batch => <option key={batch.batchId} value={batch.batchId}>{batch.batchId} · {batch.vaccineType || "Vaccine"}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">Journey events<select aria-label="Journey event filter" value={filter} onChange={event => setFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
        {kinds.map(kind => <option key={kind} value={kind}>{kind === "all" ? "All events" : kind[0].toUpperCase() + kind.slice(1)}</option>)}</select></label>
    </div>
    {error && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {loading && journey && <p role="status" className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">Refreshing journey records… Existing data remains visible until the refresh completes.</p>}
    {loadingBatches && !batches.length && <p role="status" className="rounded-lg border border-dashed border-border-strong bg-surface-muted p-5 text-sm text-ink-500">Loading batches available to this account…</p>}
    {!loading && !loadingBatches && !error && !batches.length && <p className="rounded-lg border border-dashed border-border-strong bg-surface-muted p-5 text-sm text-ink-500">No batches are currently visible to your signed-in role.</p>}
    {journey && <>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-900">{journey.batch.batchId}</span><span>{journey.batch.vaccineType}</span><span>· {journey.batch.quantity?.toLocaleString?.() || journey.batch.quantity || 0} doses</span>
        <StatusBadge value={journey.batch.coldChainStatus || journey.batch.disposition?.status || journey.batch.status || "Status unavailable"} />
        {!journey.policy && <span className="text-xs text-amber-800">No approved cold-chain policy</span>}</div>
      {journey.batch.disposition?.status && journey.batch.disposition.status !== "active" && <p className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><strong>Terminal disposition: {journey.batch.disposition.status}</strong>{journey.batch.disposition.reason ? ` · ${journey.batch.disposition.reason}` : ""}{journey.batch.disposition.recordedAt ? ` · ${dateText(journey.batch.disposition.recordedAt)}` : ""}</p>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[ ["Latest humidity", latest?.humidity == null ? "—" : `${Number(latest.humidity).toFixed(1)}%`],
          ["Average humidity", humidityAverage == null || !Number.isFinite(humidityAverage) ? "—" : `${humidityAverage.toFixed(1)}%`],
          ["Latest battery", latest?.batteryLevel == null ? "—" : `${Number(latest.batteryLevel).toFixed(1)}%`],
          ["Latest simulated GPS", lastGps ? `${Number(lastGps.latitude).toFixed(5)}, ${Number(lastGps.longitude).toFixed(5)}` : "—"] ].map(([label, value]) => <div key={label} className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-3"><p className="text-xs font-medium uppercase tracking-wide text-emerald-800">{label}</p><p className="mt-1 break-words font-semibold text-slate-800">{value}</p></div>)}
      </div>
      <div className="mb-6 rounded-xl border border-slate-200 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-slate-800">Temperature over recorded simulation time</h3><p className="text-xs text-slate-500">{readings.length} persisted reading{readings.length === 1 ? "" : "s"}{journey.policy ? ` · currently attached approved range ${journey.policy.minimumTemperature}–${journey.policy.maximumTemperature}°C` : " · approved limits unavailable"}</p><p className="mt-1 text-xs text-slate-500">Historical alert records retain their policy snapshot; stored normal readings do not retain a policy version identifier.</p></div><span className="text-xs text-slate-500">{latest?.deviceId ? `Device ${latest.deviceId}` : "Sensor history"}</span></div>
        {readings.length ? <div className="h-72"><Line data={chartData} options={{ responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: "index" }, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: item => `${item.dataset.label}: ${item.parsed.y == null ? "—" : `${item.parsed.y}°C`}` } } }, scales: { x: { ticks: { maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } }, y: { title: { display: true, text: "Temperature (°C)" } } } }} /></div>
          : <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-600">No sensor readings have been stored for this batch yet. Run one simulator tick, then refresh this view.</p>}
        {journey.alerts?.length ? <div className="mt-4 flex flex-wrap gap-2">{journey.alerts.map(alert => <StatusBadge key={alert.alertId} value={alert.severity} tone={alert.severity === "CRITICAL" ? "danger" : "warning"} className="gap-1"><Bell size={12} />{alert.severity} · {alert.phase || alert.status} · {dateText(alert.timestamp)}</StatusBadge>)}</div> : null}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
        <div><div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-semibold text-slate-800">End-to-end event timeline</h3><span className="text-xs text-slate-500">Oldest first</span></div>
          {filteredEvents.length ? <ol className="relative space-y-3 border-l-2 border-emerald-100 pl-4">{filteredEvents.map(event => { const Icon = iconFor(event.kind); return <li key={event.id} className={`relative rounded-xl border p-3 ${colorFor(event.kind)}`}>
            <span className="absolute -left-[23px] top-4 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-emerald-700 text-white"><Icon size={9} /></span>
            <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-semibold">{event.title}</p><time className="text-xs opacity-75">{dateText(event.at)}</time></div>
            <p className="mt-1 break-words text-sm">{event.detail || "Workflow event recorded"}</p><p className="mt-2 text-xs opacity-80">Role: {event.role} · Responsible: {event.actor}{event.deviceId ? ` · Device: ${event.deviceId}` : ""}</p>
            {event.temperature != null && <p className="mt-1 text-xs">{event.temperature}°C{event.humidity != null ? ` · ${event.humidity}% humidity` : ""}{event.latitude != null && event.longitude != null ? <><MapPin size={12} className="mx-1 inline" />{event.latitude}, {event.longitude}</> : null}</p>}
          </li>; })}</ol> : <p className="rounded-lg border border-dashed p-5 text-sm text-slate-600">No events match this filter.</p>}</div>
        <aside className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4"><h3 className="mb-3 font-semibold text-slate-800">Approved cold-chain policy</h3>
          {journey.policy ? <dl className="space-y-3 text-sm"><div><dt className="text-xs uppercase text-slate-500">Temperature limits</dt><dd className="font-semibold">{journey.policy.minimumTemperature}°C to {journey.policy.maximumTemperature}°C</dd></div>
            {journey.policy.minimumHumidity != null && <div><dt className="text-xs uppercase text-slate-500">Humidity limits</dt><dd>{journey.policy.minimumHumidity}% to {journey.policy.maximumHumidity}%</dd></div>}
            <div><dt className="text-xs uppercase text-slate-500">Sustained excursion rule</dt><dd>{Math.round(journey.policy.excursionDurationMs / 60000)} min · maximum reading gap {Math.round(journey.policy.maximumReadingGapMs / 1000)} sec</dd></div>
            <div><dt className="text-xs uppercase text-slate-500">Policy source</dt><dd className="break-words">{journey.policy.sourceReference}</dd></div>
            <p className="border-t border-emerald-100 pt-3 text-xs text-slate-600">The chart is a software prototype view. It does not determine clinical suitability or release quarantined inventory.</p></dl>
            : <p className="text-sm text-amber-900">No approved policy is attached to this batch. Telemetry remains visible, but this chart will not invent product limits.</p>}
        </aside>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <aside className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold text-slate-800">Blockchain references</h3>
          <p className="mt-1 text-xs text-slate-600">{journey.blockchain?.status === "available" ? "Read from the configured local Hardhat contract." : journey.blockchain?.status === "unavailable" ? "The local contract could not be read; stored transaction references remain listed where available." : "Only stored references visible to this organization are shown."}</p>
          {journey.blockchain?.references?.length ? <ul className="mt-3 space-y-2">{journey.blockchain.references.map((reference, index) => <li key={`${reference.txHash}-${index}`} className="rounded-lg bg-slate-50 p-2 text-xs"><span className="font-medium">{reference.label || reference.source}</span><span className="ml-2 text-slate-500">{reference.source} · {dateText(reference.timestamp)}</span><code className="mt-1 block break-all text-slate-700">{reference.txHash}</code></li>)}</ul> : <p className="mt-3 text-sm text-slate-600">No visible transaction hashes are stored for this batch.</p>}
          {journey.blockchain?.lifecycle?.length ? <div className="mt-3 border-t pt-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contract lifecycle events</p><ul className="mt-2 space-y-2">{journey.blockchain.lifecycle.map((entry, index) => <li key={`${entry.timestamp}-${index}`} className="text-xs"><span className="font-medium">{entry.action}</span> · {entry.actorRole} · {dateText(Number(entry.timestamp) * 1000)}{entry.txHash && <code className="ml-2 break-all">{entry.txHash}</code>}{entry.transactionCorrelation === "inferred-label-match-not-chain-proof" && <span className="ml-2 text-amber-800">stored hash matched by label; not chain proof</span>}</li>)}</ul></div> : null}
        </aside>
        {journey.forecast && <aside className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold text-slate-800">Production-time forecast context</h3><p className="mt-1 text-xs text-slate-600">Historical stored context only; this is not a fresh forecast.</p><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Recorded demand estimate</dt><dd className="font-semibold">{Number(journey.forecast.predictedDemand || 0).toLocaleString()}</dd></div><div><dt className="text-xs text-slate-500">Source record</dt><dd>{journey.forecast.source}</dd></div><div><dt className="text-xs text-slate-500">Recorded at</dt><dd>{dateText(journey.forecast.issuedAt)}</dd></div><div><dt className="text-xs text-slate-500">Certificate</dt><dd className="break-all">{journey.forecast.certificateId || "No certificate ID"}</dd></div></dl>{journey.forecast.sourceSeries?.length > 0 && <p className="mt-3 break-words border-t pt-3 text-xs text-slate-600">Stored forecast input series ({journey.forecast.sourceSeries.length} latest values): {journey.forecast.sourceSeries.join(", ")}</p>}</aside>}
      </div>
    </>}
    {!journey && loading && <div role="status" className="space-y-3 py-5" aria-label="Loading batch journey"><p className="text-center text-sm text-ink-500">Loading the role-scoped journey…</p><div className="h-24 animate-pulse rounded-xl bg-brand-50" /><div className="h-56 animate-pulse rounded-xl bg-brand-50" /></div>}
    {!journey && !loading && !error && !loadingBatches && batchId && <p className="rounded-lg border border-dashed border-border-strong bg-surface-muted p-5 text-sm text-ink-500">No journey details are available for this batch yet. Refresh after a shipment, telemetry reading, or workflow event is recorded.</p>}
  </section>;
}
