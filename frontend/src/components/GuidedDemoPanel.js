import React, { useCallback, useEffect, useState } from "react";
import { Clipboard, ClipboardCheck, ExternalLink, PlayCircle, RefreshCw } from "lucide-react";
import { fetchAdminOrders } from "../services/workflow";
import { fetchBatchJourney, fetchTraceabilityBatches } from "../services/traceability";
import { fetchManualSimulatorOverrides, fetchSimulatorStatuses } from "../services/simulator";
import { fetchTemperatureAlerts } from "../services/alerts";
import { manualSimulatorConsoleEnabled } from "../config/features";

const STORAGE_KEY = "vaccine.guidedDemoRun.v1";
function loadRun() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (_) { return null; } }
function token() { return (window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).replaceAll("-", "").slice(-10).toUpperCase(); }
function createRun() { const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", ""); const id = `${stamp}-${token()}`; return { batchId: `DEMO-BATCH-${id}`, deviceId: `DEMO-IOT-${id}`, reference: `DEMO-RUN-${id}`, createdAt: new Date().toISOString() }; }
const paths = { manufacturer: "/manufacturer", hospital: "/hospital", admin: "/admin", distributor: "/distributor" };
function Step({ index, done, title, role, children }) { return <li className={`rounded-xl border p-4 ${done ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-white"}`}><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold text-slate-800">{done ? "✓ " : `${index}. `}{title}</h3><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{role}</span></div><div className="mt-2 text-sm text-slate-600">{children}</div></li>; }

const requiredResponseAudit = ["RESPONSE ACKNOWLEDGED", "RESPONSE ACTION TAKEN", "QUALITY REVIEW", "CLEAR AUTHORIZED", "RESPONSE RESOLVED"];
function manualScenarioVerified(violationType, data) {
  const alert = (data.alerts || []).find(item => item.violationType === violationType
    && item.context?.source === "manual-override" && item.phase === "CLEARED"
    && item.requiresQualityReview === false && item.responseState === "RESOLVED"
    && String(item.responseResolvedNote || "").trim().length >= 3 && item.excursionClosedAt);
  if (!alert) return false;
  const audit = (data.journey?.events || []).filter(event => event.kind === "audit" && event.alertId === alert.alertId);
  const actions = new Set(audit.map(event => String(event.title || "").toUpperCase()));
  if (!requiredResponseAudit.every(action => actions.has(action))) return false;
  if (!audit.every(event => String(event.detail || "").trim().length >= 3)) return false;
  const overrideReleased = (data.overrides || []).some(item => item.shipmentId === alert.shipmentId
    && item.status === "RELEASED" && +new Date(item.releasedAt) >= +new Date(alert.excursionStartedAt));
  const automaticRecovery = (data.journey?.readings || []).some(reading => reading.shipmentId === alert.shipmentId
    && reading.source === "auto-simulated" && reading.evaluation?.violationType === "NORMAL"
    && +new Date(reading.recordedAt) > +new Date(alert.excursionClosedAt));
  return overrideReleased && automaticRecovery;
}

export default function GuidedDemoPanel() {
  const [run, setRun] = useState(loadRun);
  const [data, setData] = useState({ batches: [], orders: [], devices: [], journey: null, alerts: [], overrides: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [notice, setNotice] = useState("");
  const start = () => { const next = createRun(); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setRun(next); setData({ batches: [], orders: [], devices: [], journey: null, alerts: [], overrides: [] }); setNotice("Fresh synthetic demo identifiers generated. Existing project records were not changed or deleted."); setError(""); };
  const refresh = useCallback(async () => {
    if (!run) return;
    setLoading(true); setError("");
    const results = await Promise.allSettled([fetchTraceabilityBatches(), fetchAdminOrders(), fetchSimulatorStatuses()]);
    if (results.some(result => result.status === "rejected")) {
      const denied = results.find(result => result.status === "rejected")?.reason;
      setError(denied?.response?.data?.error || "Some demo progress could not be checked. Confirm you are signed in as Admin and refresh.");
    }
    const batches = results[0].status === "fulfilled" ? results[0].value.batches || [] : [];
    const orders = results[1].status === "fulfilled" ? results[1].value.orders || [] : [];
    const devices = results[2].status === "fulfilled" ? results[2].value.simulations || [] : [];
    let journey = null;
    if (batches.some(batch => batch.batchId === run.batchId)) {
      try { journey = await fetchBatchJourney(run.batchId); } catch (_) { /* partial progress is still useful */ }
    }
    let alerts = [];
    let overrides = [];
    const shipmentId = [...(journey?.events || [])].reverse().find(event => event.kind === "shipment" && event.shipmentId)?.shipmentId;
    if (shipmentId) {
      const [alertResult, overrideResult] = await Promise.allSettled([
        fetchTemperatureAlerts({ batchId: run.batchId }),
        fetchManualSimulatorOverrides({ shipmentId, status: "ALL", limit: 100 }),
      ]);
      alerts = alertResult.status === "fulfilled" ? alertResult.value.alerts || [] : [];
      // The manual-override feature flag may be off outside a local demo; that
      // leaves this step pending without turning the rest of the guide into an error.
      overrides = overrideResult.status === "fulfilled" ? overrideResult.value.overrides || [] : [];
    }
    setData({ batches, orders, devices, journey, alerts, overrides }); setLoading(false);
  }, [run]);
  useEffect(() => { if (run) refresh(); }, [run, refresh]);
  const copy = async (label, value) => { try { await navigator.clipboard.writeText(value); setCopied(label); setTimeout(() => setCopied(""), 1800); } catch (_) { setNotice(`Copy is unavailable. Select and copy this value: ${value}`); } };

  if (!run) return <section id="admin-demo-mode" aria-label="Guided demo mode" className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950"><PlayCircle size={19} /> Guided demo mode</h2><p className="mt-1 text-sm text-slate-600">Generate a unique synthetic batch, device and order-reference bundle, then follow the user-entered workflow across the role dashboards. This helper does not create or delete supply-chain records.</p></div><button type="button" onClick={start} className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white">Start a fresh demo run</button></div></section>;

  const batchDone = data.batches.some(batch => batch.batchId === run.batchId);
  const matchingOrder = data.orders.find(order => String(order.notes || "").includes(run.reference));
  const journeyShipments = data.journey?.events?.filter(event => event.kind === "shipment") || [];
  const shipmentDone = journeyShipments.length > 0 || data.orders.some(order => order.allocatedBatchId === run.batchId && order.shipmentId);
  const device = data.devices.find(item => item.deviceId === run.deviceId && item.batchId === run.batchId);
  const sensorDone = Boolean(device && device.ticksGenerated > 0);
  const recordDone = Boolean(data.journey?.events?.some(event => event.kind === "order") && journeyShipments.length && data.journey?.readings?.some(reading => reading.deviceId === run.deviceId));
  const manualOverrideDone = manualScenarioVerified("HIGH_TEMPERATURE", data) && manualScenarioVerified("LOW_HUMIDITY", data);
  const steps = [batchDone, Boolean(matchingOrder), shipmentDone, sensorDone, recordDone, manualOverrideDone];
  const completed = steps.filter(Boolean).length;

  return <section id="admin-demo-mode" aria-label="Guided demo mode" className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950"><PlayCircle size={19} /> Guided demo mode</h2><p className="mt-1 text-sm text-slate-600">Complete a clean synthetic run using the real forms. IDs are unique and stored in this browser only; restarting the guide never removes existing data.</p></div><div className="flex gap-2"><button type="button" onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm text-emerald-900"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh progress</button><button type="button" onClick={start} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">New IDs</button></div></div>
    {error && <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}{notice && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    <div className="mb-4 rounded-xl bg-emerald-50 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Run progress</p><p className="font-semibold text-emerald-950">{completed} of 6 steps verified from saved records</p></div><div className="h-2 w-40 overflow-hidden rounded-full bg-white"><div className="h-full bg-emerald-700 transition-all" style={{ width: `${completed / steps.length * 100}%` }} /></div></div>
      {[["Batch ID", run.batchId], ["Order note reference", run.reference], ["Sensor Device ID", run.deviceId]].map(([label, value]) => <div key={label} className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-100 py-2 text-sm"><span className="text-emerald-900">{label}</span><span className="inline-flex items-center gap-2 font-mono text-xs"><code>{value}</code><button type="button" aria-label={`Copy ${label}`} onClick={() => copy(label, value)} className="rounded border border-emerald-200 bg-white p-1.5"><ClipboardCheck size={14} className={copied === label ? "text-emerald-700" : "text-slate-500"} /></button></span></div>)}</div>
    <ol className="grid gap-3 lg:grid-cols-2">
      <Step index={1} done={batchDone} title="Create and release the synthetic batch" role="Manufacturer"><p>Open Manufacturer, choose Create New Batch, and use the generated Batch ID, a clearly synthetic vaccine label, and a future expiry. After the batch is created, complete both Production Sign and Lab Sign in the batch records; allocation requires a released batch.</p><a href={`${paths.manufacturer}#create-batch-panel`} className="mt-2 inline-flex items-center gap-1 font-medium text-emerald-800">Open Manufacturer <ExternalLink size={13} /></a></Step>
      <Step index={2} done={Boolean(matchingOrder)} title="Submit a hospital order" role="Hospital"><p>Open the hospital form and submit a new order. Put the generated Order note reference exactly in Notes so the guide can find this record. Use the same vaccine type as the batch.</p>{matchingOrder && <p className="mt-2 font-medium text-emerald-800">Verified order {matchingOrder.orderId} · {matchingOrder.status}</p>}<a href={`${paths.hospital}#hospital-orders`} className="mt-2 inline-flex items-center gap-1 font-medium text-emerald-800">Open Hospital order form <ExternalLink size={13} /></a></Step>
      <Step index={3} done={shipmentDone} title="Review the order and assign a shipment" role="Admin → Distributor"><p>In Order Review, allocate the generated batch and an available distributor to the matching order. Then use the Distributor shipment workflow to verify and progress delivery. The shipment is checked against stored batch/order links.</p>{shipmentDone && <p className="mt-2 font-medium text-emerald-800">A shipment is linked to this batch.</p>}<a href={`${paths.admin}#admin-orders`} className="mt-2 inline-flex items-center gap-1 font-medium text-emerald-800">Open Admin order review <ExternalLink size={13} /></a><a href={`${paths.distributor}#distributor-shipments`} className="ml-4 mt-2 inline-flex items-center gap-1 font-medium text-emerald-800">Open Distributor shipments <ExternalLink size={13} /></a></Step>
      <Step index={4} done={sensorDone} title="Run a seeded virtual sensor" role="Manufacturer or Admin"><p>Create a virtual device using the generated Device ID and Batch ID, choose a fixed seed and NORMAL or HIGH_TEMPERATURE, then tick once or start. Simulator progress is checked from the saved device/telemetry records.</p>{sensorDone && <p className="mt-2 font-medium text-emerald-800">Verified {device.ticksGenerated} saved sensor tick(s) · {device.scenario}</p>}<a href={`${paths.manufacturer}#manufacturer-simulator`} className="mt-2 inline-flex items-center gap-1 font-medium text-emerald-800">Open virtual sensor controls <ExternalLink size={13} /></a></Step>
      <Step index={5} done={recordDone} title="Inspect the end-to-end saved journey" role="Admin / all assigned roles"><p>Use Shipment journey &amp; sensor history below to inspect the order, shipment events, timestamps, responsible roles, readings and policy limits. Switch roles to see how the view is safely scoped. To demonstrate the remaining events, the Hospital can confirm a supplied delivery and record an administration using a synthetic patient reference.</p>{recordDone && <p className="mt-2 font-medium text-emerald-800">Order, shipment and generated-device telemetry appear in the journey.</p>}<a href="#shipment-journey" className="mt-2 inline-flex items-center gap-1 font-medium text-emerald-800">Go to journey timeline <ExternalLink size={13} /></a></Step>
      <Step index={6} done={manualOverrideDone} title="Run manual excursions and complete reviewed recovery" role="Admin → Manufacturer → Quality reviewer"><p>With both local override flags enabled, open the Manual Sensor Console for this shipment. Run a high-temperature hold long enough to quarantine, then repeat with low humidity (only when the approved policy has humidity bounds). Confirm the assigned roles receive in-app alerts; acknowledge and record an action with a note; release each override; record a fresh automatic in-range reading; then have a designated reviewer review and clear the hold with a note. Recovery readings and release alone must leave the hold in place.</p>{manualOverrideDone && <p className="mt-2 font-medium text-emerald-800">Verified cleared manual high-temperature and low-humidity alerts, response audit notes, released overrides, and automatic recovery readings.</p>}{manualSimulatorConsoleEnabled ? <a href="/admin/manual-simulator" className="mt-2 inline-flex items-center gap-1 font-medium text-emerald-800">Open Manual Sensor Console <ExternalLink size={13} /></a> : <p className="mt-2 text-xs text-amber-800">The console is hidden until both local demo override flags are enabled and the frontend is restarted.</p>}</Step>
    </ol>
    <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><Clipboard size={14} className="mr-1 inline" />Cold-chain evaluation requires an explicitly approved product policy. HIGH_TEMPERATURE and low-humidity overrides are synthetic test behavior and must not be presented as a clinical conclusion. For delivery/administration steps, first complete the shipment and hospital receipt workflow; quarantine intentionally blocks those actions.</p>
    <p className="mt-2 text-xs text-slate-500">Guide state is local to this browser; supply-chain records are stored by the existing backend. Refresh this panel after each role submits a step. Reference: {run.reference} · created {new Date(run.createdAt).toLocaleString()}</p>
  </section>;
}
