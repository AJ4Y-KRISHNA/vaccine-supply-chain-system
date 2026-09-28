import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Activity, AlertTriangle, ArrowLeft, Battery, Clock3, Droplets, MapPin, RefreshCw, ShieldCheck, Thermometer, Truck, Zap } from "lucide-react";
import { manualSimulatorConsoleEnabled } from "../config/features";
import * as simulator from "../services/simulator";
import { fetchColdChainPolicy, fetchTemperatureAlerts } from "../services/alerts";

const initialForm = {
  presetId: "", temperatureEnabled: true, humidityEnabled: false,
  targetTemperature: "5", targetHumidity: "60", behavior: "hold",
  rampDuration: "0", holdDuration: "10", expiresMinutes: "30",
  reason: "Synthetic classroom demonstration",
};
const asFinite = value => value !== "" && Number.isFinite(Number(value));
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Time unavailable";
const durationText = milliseconds => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map(value => String(value).padStart(2, "0")).join(":");
};
const errorText = error => String(error?.response?.data?.error || error?.message || "Request failed. Check the backend and your admin session.");

function currentReadingFor(devices, shipmentId) {
  return (devices || []).filter(item => item.shipmentId === shipmentId)
    .sort((left, right) => Date.parse(right.lastReading?.timestamp || 0) - Date.parse(left.lastReading?.timestamp || 0))[0] || null;
}

export default function ManualSimulatorConsole({ enabled = manualSimulatorConsoleEnabled }) {
  const location = useLocation();
  const requestedShipmentId = useMemo(() => new URLSearchParams(location.search).get("shipmentId") || "", [location.search]);
  const [inputs, setInputs] = useState({ batches: [], shipments: [] });
  const [devices, setDevices] = useState([]);
  const [presets, setPresets] = useState([]);
  const [expiry, setExpiry] = useState({ default: 1800000, max: 86400000 });
  const [shipmentId, setShipmentId] = useState(requestedShipmentId);
  const [policy, setPolicy] = useState(null);
  const [batchAlerts, setBatchAlerts] = useState([]);
  const [holdStatusAvailable, setHoldStatusAvailable] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmExtreme, setConfirmExtreme] = useState(false);
  const operationInFlight = useRef(false);

  const selectedShipment = useMemo(() => inputs.shipments.find(item => item.shipmentId === shipmentId) || null, [inputs.shipments, shipmentId]);
  const selectedBatch = useMemo(() => inputs.batches.find(item => item.batchId === selectedShipment?.batchId) || null, [inputs.batches, selectedShipment]);
  const linkedDevice = useMemo(() => currentReadingFor(devices, shipmentId), [devices, shipmentId]);
  const latestReading = linkedDevice?.lastReading || null;
  const activeOverride = useMemo(() => overrides.find(item => item.status === "ACTIVE" && item.mode === "manual") || null, [overrides]);
  const quarantined = batchAlerts.some(alert => alert.requiresQualityReview && alert.phase !== "CLEARED");
  const recentAlerts = alerts.slice(0, 5);

  const refreshBase = useCallback(async () => {
    const [optionResult, statusResult, presetResult] = await Promise.all([
      simulator.fetchSimulatorInputs(), simulator.fetchSimulatorStatuses(), simulator.fetchManualSimulatorPresets(),
    ]);
    const nextInputs = { batches: optionResult.batches || [], shipments: optionResult.shipments || [] };
    setInputs(nextInputs);
    setDevices(statusResult.simulations || []);
    setPresets(presetResult.presets || []);
    setExpiry(presetResult.expiry || { default: 1800000, max: 86400000 });
    setShipmentId(current => {
      if (current && nextInputs.shipments.some(item => item.shipmentId === current)) return current;
      if (requestedShipmentId && nextInputs.shipments.some(item => item.shipmentId === requestedShipmentId)) return requestedShipmentId;
      return nextInputs.shipments[0]?.shipmentId || "";
    });
    setForm(current => current.expiresMinutes ? current : {
      ...current, expiresMinutes: String(Math.max(0.001, Number((Number(presetResult.expiry?.default || 1800000) / 60000).toFixed(3)))),
    });
    setLoadError("");
  }, [requestedShipmentId]);

  const refreshLive = useCallback(async () => {
    if (!shipmentId || !selectedShipment?.batchId) {
      setPolicy(null); setAlerts([]); setBatchAlerts([]); setOverrides([]); setHoldStatusAvailable(false); return;
    }
    const results = await Promise.allSettled([
      simulator.fetchSimulatorStatuses(),
      simulator.fetchManualSimulatorOverrides({ shipmentId, status: "ALL", limit: 50 }),
      fetchTemperatureAlerts({ batchId: selectedShipment.batchId, limit: 20 }),
      fetchColdChainPolicy(selectedShipment.batchId),
    ]);
    const failures = [];
    if (results[0].status === "fulfilled") setDevices(results[0].value.simulations || []);
    else failures.push(`Sensor status: ${errorText(results[0].reason)}`);
    if (results[1].status === "fulfilled") setOverrides(results[1].value.overrides || []);
    else failures.push(`Override status: ${errorText(results[1].reason)}`);
    if (results[2].status === "fulfilled") {
      const batchRecords = results[2].value.alerts || [];
      setBatchAlerts(batchRecords);
      setAlerts(batchRecords.filter(alert => !alert.shipmentId || alert.shipmentId === shipmentId));
      setHoldStatusAvailable(true);
    }
    else failures.push(`Alerts: ${errorText(results[2].reason)}`);
    if (results[3].status === "fulfilled") setPolicy(results[3].value.policyStatus === "APPROVED" ? results[3].value.policy : null);
    else failures.push(`Approved policy: ${errorText(results[3].reason)}`);
    setLoadError(failures.join(" "));
  }, [shipmentId, selectedShipment?.batchId]);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setLoading(true);
    refreshBase().catch(error => { if (alive) setLoadError(errorText(error)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [enabled, refreshBase]);

  useEffect(() => {
    if (!enabled || !shipmentId) return undefined;
    let alive = true;
    const refresh = () => {
      if (!operationInFlight.current && document.visibilityState !== "hidden") {
        refreshLive().catch(error => { if (alive) setLoadError(errorText(error)); });
      }
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [enabled, shipmentId, selectedShipment?.batchId, refreshLive]);

  const hydratedOverrideKey = useRef("");
  useEffect(() => {
    if (!activeOverride) { hydratedOverrideKey.current = ""; return; }
    const version = activeOverride.updatedAt || activeOverride.effectiveAt || activeOverride.createdAt;
    const key = `${activeOverride.overrideId}:${version}`;
    if (hydratedOverrideKey.current === key) return;
    hydratedOverrideKey.current = key;
    setForm(current => ({
      ...current,
      presetId: activeOverride.presetId || "",
      temperatureEnabled: activeOverride.targetTemperature != null,
      humidityEnabled: activeOverride.targetHumidity != null,
      targetTemperature: activeOverride.targetTemperature == null ? current.targetTemperature : String(activeOverride.targetTemperature),
      targetHumidity: activeOverride.targetHumidity == null ? current.targetHumidity : String(activeOverride.targetHumidity),
      behavior: activeOverride.behavior || "hold",
      rampDuration: String(activeOverride.rampDuration ?? 0),
      holdDuration: String(activeOverride.holdDuration ?? 10),
      expiresMinutes: String(Math.max(0.001, Number(((Date.parse(activeOverride.expiresAt) - Date.parse(activeOverride.effectiveAt || activeOverride.createdAt)) / 60000).toFixed(3)))),
      reason: activeOverride.reason || current.reason,
    }));
  }, [activeOverride]);

  const editForm = (name, value) => {
    setForm(current => ({ ...current, [name]: value, ...(name === "targetTemperature" || name === "targetHumidity" ? { presetId: "" } : {}) }));
    setFormError(""); setConfirmExtreme(false);
  };

  const choosePreset = preset => {
    setForm(current => ({
      ...current, presetId: preset.id,
      temperatureEnabled: preset.targetTemperature != null,
      humidityEnabled: preset.targetHumidity != null,
      targetTemperature: preset.targetTemperature == null ? current.targetTemperature : String(preset.targetTemperature),
      targetHumidity: preset.targetHumidity == null ? current.targetHumidity : String(preset.targetHumidity),
      behavior: preset.behavior || "hold", rampDuration: String(preset.rampDuration ?? 0),
      holdDuration: String(preset.holdDuration ?? 10),
      expiresMinutes: String(Math.max(Number(current.expiresMinutes) || 0,
        Math.ceil((Number(preset.rampDuration || 0) + Number(preset.holdDuration || 0)) || 1))),
    }));
    setFormError(""); setConfirmExtreme(false);
  };

  function buildPayload() {
    if (!selectedShipment) throw new Error("Select an existing shipment first.");
    if (!policy) throw new Error("This batch needs an approved cold-chain policy before a controlled demo can be applied.");
    if (!linkedDevice) throw new Error("Create a virtual device linked to this shipment before applying a manual reading.");
    const rampDuration = Number(form.rampDuration);
    const holdDuration = Number(form.holdDuration);
    const expiryMs = Math.round(Number(form.expiresMinutes) * 60000);
    const maximumTtl = Number(expiry.max || 86400000);
    if (!Number.isFinite(rampDuration) || rampDuration < 0 || rampDuration > 1440 || (form.behavior === "ramp" && rampDuration <= 0)) throw new Error("Ramp duration must be 0–1440 minutes (and greater than 0 for ramp behavior).");
    if (!Number.isFinite(holdDuration) || holdDuration <= 0 || holdDuration > 1440) throw new Error("Hold duration must be greater than 0 and no more than 1440 simulated minutes.");
    if (!Number.isSafeInteger(expiryMs) || expiryMs < 10 || expiryMs > maximumTtl) throw new Error(`Expiry must be at least 0.001 simulated minutes and no more than ${(maximumTtl / 60000).toFixed(3)} minutes.`);
    if ((rampDuration + holdDuration) * 60000 > expiryMs) throw new Error("Expiry must cover the selected ramp and hold durations.");
    const reason = form.reason.trim();
    if (!reason || reason.length > 500) throw new Error("Enter a reason of 1–500 characters for the audit trail.");
    const payload = { shipmentId, behavior: form.behavior, rampDuration, holdDuration, expiresInMs: expiryMs, reason };
    if (form.presetId) return { ...payload, presetId: form.presetId };
    const selectedTemperature = form.temperatureEnabled;
    const selectedHumidity = form.humidityEnabled;
    if (!selectedTemperature && !selectedHumidity) throw new Error("Select a temperature or humidity target, or choose the Sensor fault preset.");
    if (selectedTemperature && (!asFinite(form.targetTemperature) || Number(form.targetTemperature) < -40 || Number(form.targetTemperature) > 60)) throw new Error("Temperature target must be between -40 and 60°C.");
    if (selectedHumidity && (!asFinite(form.targetHumidity) || Number(form.targetHumidity) < 0 || Number(form.targetHumidity) > 100)) throw new Error("Humidity target must be between 0 and 100%.");
    if (selectedTemperature) payload.targetTemperature = Number(form.targetTemperature);
    if (selectedHumidity) payload.targetHumidity = Number(form.targetHumidity);
    return payload;
  }

  function outsideApprovedRange(payload) {
    const selectedPreset = presets.find(item => item.id === payload.presetId);
    const temperature = selectedPreset?.targetTemperature ?? payload.targetTemperature;
    const humidity = selectedPreset?.targetHumidity ?? payload.targetHumidity;
    const temperatureOutside = temperature != null &&
      (temperature < policy.minimumTemperature || temperature > policy.maximumTemperature);
    const humidityOutside = humidity != null && (
      (policy.minimumHumidity != null && humidity < policy.minimumHumidity) ||
      (policy.maximumHumidity != null && humidity > policy.maximumHumidity)
    );
    return temperatureOutside || humidityOutside;
  }

  async function runAction(label, action) {
    if (operationInFlight.current) return;
    operationInFlight.current = true; setBusy(label); setLoadError(""); setFormError(""); setNotice("");
    try {
      const result = await action();
      setNotice(result?.message || "Simulator control updated.");
      await refreshLive();
    } catch (error) { setFormError(errorText(error)); }
    finally { operationInFlight.current = false; setBusy(""); }
  }

  function applyOverride(confirmed = false) {
    let payload;
    try { payload = buildPayload(); }
    catch (error) { setFormError(error.message); return; }
    if (outsideApprovedRange(payload) && !confirmed) { setConfirmExtreme(true); return; }
    setConfirmExtreme(false);
    runAction(activeOverride ? "update" : "apply", () => activeOverride
      ? simulator.updateManualSimulatorOverride(activeOverride.overrideId, payload)
      : simulator.createManualSimulatorOverride(payload));
  }

  const release = () => activeOverride && runAction("release", () => simulator.releaseManualSimulatorOverride(activeOverride.overrideId, {
    reason: "Operator returned this shipment to automatic simulation from the manual control console.",
  }));
  const generateReading = () => linkedDevice && runAction("tick", () => simulator.tickSimulation(linkedDevice.deviceId));
  const refreshAll = async () => {
    setRefreshing(true); setLoadError("");
    try { await refreshBase(); await refreshLive(); }
    catch (error) { setLoadError(errorText(error)); }
    finally { setRefreshing(false); }
  };

  if (!enabled) return null;

  const latestAt = latestReading?.timestamp;
  const source = latestReading?.source || latestReading?.simulation?.telemetrySource || "unknown";
  const sourceText = source === "manual-override" ? "Manual override" : source === "auto-simulated" ? "Automatic simulator" : source === "unknown" ? "No reading yet" : source;
  const readingLocation = latestReading?.location || null;
  const endAt = activeOverride ? Math.min(Date.parse(activeOverride.expiresAt),
    Date.parse(activeOverride.effectiveAt || activeOverride.createdAt) + (Number(activeOverride.rampDuration || 0) + Number(activeOverride.holdDuration || 0)) * 60000) : null;
  const simulatedClock = linkedDevice?.nextTimestamp || latestAt;
  const remaining = endAt && simulatedClock ? Math.max(0, endAt - Date.parse(simulatedClock)) : 0;

  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-800 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link className="inline-flex items-center gap-2 text-sm font-semibold" to="/admin"><ArrowLeft size={16} /> Back to Admin Dashboard</Link>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Manual Simulator Control</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Control a synthetic sensor reading for one shipment. The existing cold-chain policy engine remains responsible for alert and quarantine decisions.</p>
        </div>
        <button type="button" onClick={refreshAll} disabled={refreshing || Boolean(busy)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />{refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </header>

      <div role="note" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm">
        <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={20} />
        <div><p className="font-bold tracking-wide">SIMULATOR TOOL — SYNTHETIC DATA ONLY</p><p className="mt-1 text-sm">This local demo does not control physical equipment and is not a vaccine-safety determination. Policy rules—not this console—create alerts and quality holds.</p></div>
      </div>

      {loadError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><b>Some live data could not be refreshed.</b> {loadError}</div>}
      {formError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{formError}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>}

      {loading ? <div role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">Loading shipment, policy and simulator information…</div> : null}
      {!loading && inputs.shipments.length === 0 ? <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="font-semibold">No shipment is available for control</h2><p className="mt-2 text-sm text-slate-600">Create a shipment and an approved cold-chain policy, then create a virtual device linked to that shipment from the Admin Dashboard simulator.</p><Link to="/admin#admin-cold-chain" className="mt-4 inline-flex font-semibold text-emerald-800 underline">Open existing simulator controls</Link></section> : null}

      {!loading && inputs.shipments.length > 0 ? <>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-semibold">Shipment
              <select aria-label="Controlled shipment" className="mt-2 w-full rounded-lg border border-slate-300 p-2.5 font-normal" value={shipmentId} disabled={Boolean(busy)} onChange={event => { setShipmentId(event.target.value); setPolicy(null); setBatchAlerts([]); setHoldStatusAvailable(false); setOverrides([]); setAlerts([]); setFormError(""); setNotice(""); }}>
                <option value="">Choose an existing shipment</option>{inputs.shipments.map(item => <option key={item.shipmentId} value={item.shipmentId}>{item.shipmentId}</option>)}
              </select>
            </label>
            <div className="text-sm"><span className="font-semibold">Batch and vaccine</span><p className="mt-2 rounded-lg bg-slate-50 p-2.5">{selectedBatch ? <>{selectedBatch.batchId} · {selectedBatch.vaccineType || "Vaccine not recorded"}</> : "Select a shipment to resolve its batch."}</p></div>
            <div className="text-sm"><span className="font-semibold">Approved temperature range</span><p className="mt-2 rounded-lg bg-slate-50 p-2.5">{policy ? `${policy.minimumTemperature}°C to ${policy.maximumTemperature}°C` : "Policy unavailable"}</p></div>
            <div className="text-sm"><span className="font-semibold">Shipment and sensor state</span><p className="mt-2 rounded-lg bg-slate-50 p-2.5">{linkedDevice ? `${linkedDevice.deviceId} · ${linkedDevice.running ? "Running" : "Stopped"}` : "No linked virtual device"}</p></div>
          </div>
          {policy ? <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800"><ShieldCheck size={14} /> Approved policy</span>
            {policy.minimumHumidity != null && policy.maximumHumidity != null ? <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800">Humidity {policy.minimumHumidity}%–{policy.maximumHumidity}%</span> : <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Humidity limits not configured</span>}
            <span className="text-xs text-slate-500">Policy reference: {policy.sourceReference || "Not recorded"}</span>
          </div> : selectedBatch ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No approved cold-chain policy is attached to this batch. The console will not invent safe limits or allow an override.</p> : null}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-label="Manual sensor override controls">
            <div className="mb-5"><h2 className="text-xl font-bold">Reading controls</h2><p className="mt-1 text-sm text-slate-600">Select a preset or choose one or both measurements. Values are checked against physical bounds and the batch policy.</p></div>
            <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Synthetic override presets">
              {presets.map(preset => <button key={preset.id} type="button" aria-pressed={form.presetId === preset.id} disabled={Boolean(busy) || !policy || !linkedDevice} onClick={() => choosePreset(preset)} className={`rounded-xl border p-3 text-left transition ${form.presetId === preset.id ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-200" : "border-slate-200 bg-white hover:bg-emerald-50"}`}>
                <span className="block text-sm font-semibold">{preset.name}</span><span className="mt-1 block text-xs text-slate-600">{preset.description}</span>
              </button>)}
              {!presets.length && <p className="text-sm text-slate-500">No presets were returned by the simulator service.</p>}
            </div>

            <fieldset disabled={Boolean(busy) || !policy || !linkedDevice} className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <fieldset className="rounded-xl border border-slate-200 p-4">
                  <legend className="px-1 font-semibold"><input aria-label="Enable temperature target" type="checkbox" checked={form.temperatureEnabled} onChange={event => { editForm("temperatureEnabled", event.target.checked); setForm(current => ({ ...current, presetId: "" })); }} /> <Thermometer className="mx-1 inline" size={16} />Temperature</legend>
                  <div className="flex items-center justify-between text-xs"><span>Approved range</span><b>{policy ? `${policy.minimumTemperature}°C–${policy.maximumTemperature}°C` : "Not set"}</b></div>
                  <input aria-label="Temperature target slider" className="mt-3 w-full accent-emerald-700" type="range" min="-40" max="60" step="0.1" value={form.targetTemperature} disabled={!form.temperatureEnabled || Boolean(form.presetId)} onChange={event => editForm("targetTemperature", event.target.value)} />
                  {policy && <PolicyScale min={-40} max={60} safeMin={policy.minimumTemperature} safeMax={policy.maximumTemperature} label="Temperature policy band" />}
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>-40°C</span><label className="flex items-center gap-2 text-sm text-slate-800">Target (°C)<input aria-label="Temperature target" type="number" min="-40" max="60" step="0.1" className="w-28 rounded-lg border border-slate-300 p-2" value={form.targetTemperature} disabled={!form.temperatureEnabled || Boolean(form.presetId) || Boolean(busy)} onChange={event => editForm("targetTemperature", event.target.value)} /></label><span>60°C</span></div>
                  <p className="mt-2 text-xs text-slate-500">Policy band: {policy ? `${policy.minimumTemperature}°C to ${policy.maximumTemperature}°C` : "Unavailable"}. Slider is bounded by the simulator's -40°C to 60°C input validation.</p>
                </fieldset>
                <fieldset className="rounded-xl border border-slate-200 p-4">
                  <legend className="px-1 font-semibold"><input aria-label="Enable humidity target" type="checkbox" checked={form.humidityEnabled} onChange={event => { editForm("humidityEnabled", event.target.checked); setForm(current => ({ ...current, presetId: "" })); }} /> <Droplets className="mx-1 inline" size={16} />Humidity</legend>
                  <div className="flex items-center justify-between text-xs"><span>Approved range</span><b>{policy?.minimumHumidity != null ? `${policy.minimumHumidity}%–${policy.maximumHumidity}%` : "Not configured"}</b></div>
                  <input aria-label="Humidity target slider" className="mt-3 w-full accent-emerald-700" type="range" min="0" max="100" step="0.1" value={form.targetHumidity} disabled={!form.humidityEnabled || Boolean(form.presetId)} onChange={event => editForm("targetHumidity", event.target.value)} />
                  {policy?.minimumHumidity != null && <PolicyScale min={0} max={100} safeMin={policy.minimumHumidity} safeMax={policy.maximumHumidity} label="Humidity policy band" />}
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span>0%</span><label className="flex items-center gap-2 text-sm text-slate-800">Target (%)<input aria-label="Humidity target" type="number" min="0" max="100" step="0.1" className="w-28 rounded-lg border border-slate-300 p-2" value={form.targetHumidity} disabled={!form.humidityEnabled || Boolean(form.presetId) || Boolean(busy)} onChange={event => editForm("targetHumidity", event.target.value)} /></label><span>100%</span></div>
                  <p className="mt-2 text-xs text-slate-500">Policy band: {policy?.minimumHumidity != null ? `${policy.minimumHumidity}% to ${policy.maximumHumidity}%` : "Not configured; humidity alerts are skipped by policy."}</p>
                </fieldset>
              </div>

              {form.presetId ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">Preset selected: {presets.find(item => item.id === form.presetId)?.name}. Clear it by editing a target or choosing a measurement checkbox to build a custom reading.</p> : null}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <label className="text-sm font-semibold">Behavior<select aria-label="Override behavior" className="mt-1 w-full rounded-lg border border-slate-300 p-2.5" value={form.behavior} onChange={event => editForm("behavior", event.target.value)}><option value="hold">Hold target</option><option value="ramp">Ramp then hold</option></select></label>
                <label className="text-sm font-semibold">Ramp (simulated minutes)<input aria-label="Ramp duration" type="number" min="0" max="1440" step="1" className="mt-1 w-full rounded-lg border border-slate-300 p-2.5" value={form.rampDuration} disabled={form.behavior !== "ramp"} onChange={event => editForm("rampDuration", event.target.value)} /></label>
                <label className="text-sm font-semibold">Hold (simulated minutes)<input aria-label="Hold duration" type="number" min="1" max="1440" step="1" className="mt-1 w-full rounded-lg border border-slate-300 p-2.5" value={form.holdDuration} onChange={event => editForm("holdDuration", event.target.value)} /></label>
                <label className="text-sm font-semibold">Expiry (simulated minutes)<input aria-label="Override expiry minutes" type="number" min="0.001" max={Number(expiry.max || 86400000) / 60000} step="0.001" className="mt-1 w-full rounded-lg border border-slate-300 p-2.5" value={form.expiresMinutes} onChange={event => editForm("expiresMinutes", event.target.value)} /></label>
              </div>
              <label className="block text-sm font-semibold">Reason for audit trail<textarea aria-label="Override reason" className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 font-normal" rows="2" maxLength="500" value={form.reason} onChange={event => editForm("reason", event.target.value)} /></label>
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={Boolean(busy) || !policy || !linkedDevice} onClick={() => applyOverride(false)} className="inline-flex min-h-10 min-w-36 items-center justify-center gap-2 rounded-lg border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"><Zap size={16} />{busy === "apply" ? "Applying…" : activeOverride ? "Update override" : "Apply override"}</button>
                <button type="button" disabled={Boolean(busy) || !activeOverride} onClick={release} className="inline-flex min-h-10 min-w-44 items-center justify-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50">Return to automatic</button>
              </div>
              {confirmExtreme ? <div role="alertdialog" aria-modal="false" aria-labelledby="extreme-value-title" className="rounded-xl border-2 border-amber-500 bg-amber-50 p-4">
                <h3 id="extreme-value-title" className="font-bold text-amber-950">Confirm an out-of-policy synthetic reading</h3><p className="mt-1 text-sm text-amber-950">The selected value is outside the approved range. Continuing creates synthetic sensor data only; policy alerts and any quality hold will be generated by the existing policy engine.</p>
                <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={Boolean(busy)} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50" onClick={() => applyOverride(true)}>Confirm apply synthetic override</button><button type="button" disabled={Boolean(busy)} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50" onClick={() => setConfirmExtreme(false)}>Cancel</button></div>
              </div> : null}
            </fieldset>
            {!policy || !linkedDevice ? <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{!policy ? "Select a shipment whose batch has an approved policy." : "Link a virtual device to this shipment before applying controls."} <Link className="font-semibold underline" to="/admin#admin-cold-chain">Open virtual sensor setup</Link></p> : null}
          </section>

          <section className="space-y-6" aria-label="Live shipment feedback">
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Live shipment feedback</h2><p className="text-sm text-slate-600">Refreshed from saved simulator, policy and alert records.</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${!holdStatusAvailable ? "bg-amber-100 text-amber-900" : quarantined ? "bg-rose-100 text-rose-900" : "bg-emerald-100 text-emerald-900"}`}>{!holdStatusAvailable ? "Hold status unavailable" : quarantined ? "Quarantined—pending review" : "No quality hold recorded"}</span></div>
              {latestReading ? <>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Metric icon={Thermometer} label="Temperature" value={latestReading.temperature == null ? "Missing" : `${latestReading.temperature}°C`} />
                  <Metric icon={Droplets} label="Humidity" value={latestReading.humidity == null ? "Missing" : `${latestReading.humidity}%`} />
                  <Metric icon={Battery} label="Battery" value={latestReading.batteryLevel == null ? "—" : `${latestReading.batteryLevel}%`} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600"><span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1 font-medium text-sky-900"><Activity size={13} />{sourceText}</span><span><Clock3 className="mr-1 inline" size={13} />{stamp(latestAt)}</span>{readingLocation && <span><MapPin className="mr-1 inline" size={13} />{readingLocation.lat ?? readingLocation.latitude}, {readingLocation.lng ?? readingLocation.longitude}</span>}</div>
              </> : <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">No persisted sensor reading is available for this shipment yet.</p>}
              {linkedDevice ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"><p className="text-sm"><Truck className="mr-1 inline" size={15} />{linkedDevice.deviceId} · {linkedDevice.running ? "Automatic schedule running" : "Stopped"}</p><button type="button" disabled={Boolean(busy)} onClick={generateReading} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{busy === "tick" ? "Saving reading…" : "Generate one reading"}</button></div> : null}
              <p className="mt-2 text-xs text-slate-500">Overrides take effect on the next simulator tick. This button uses the existing seeded simulator tick and policy pipeline.</p>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Recent policy alerts</h2>
              {recentAlerts.length ? <ul className="mt-3 space-y-3">{recentAlerts.map(alert => <li key={alert.alertId} className={`rounded-lg border p-3 ${alert.severity === "CRITICAL" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}><div className="flex flex-wrap items-center justify-between gap-2"><b>{alert.violationType || alert.metric || "Policy event"}</b><span className="text-xs font-semibold">{alert.severity} · {alert.responseState || alert.status || "OPEN"}</span></div><p className="mt-1 text-sm">{alert.reason}</p><p className="mt-2 text-xs">{alert.context?.source === "manual-override" ? "Source: manual override" : alert.context?.source === "auto-simulated" ? "Source: automatic simulator" : `Source: ${alert.context?.source || "temperature ingestion"}`} · {stamp(alert.timestamp)}</p><p className="mt-1 text-xs font-semibold">Recommended action: {alert.recommendedAction || "Review alert details"}</p></li>)}</ul> : <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">No policy alerts are recorded for this shipment. Out-of-range controls still need simulator readings before the policy engine can evaluate them.</p>}
            </article>

            {activeOverride ? <article className="rounded-xl border border-emerald-300 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Active manual override</h2><p className="mt-1 break-all text-sm">{activeOverride.overrideId}</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Manual mode</span></div>
              <p className="mt-2 text-sm">{activeOverride.presetId ? presets.find(item => item.id === activeOverride.presetId)?.name : "Custom sensor target"} · {activeOverride.behavior} · {activeOverride.reason}</p>
              <div className="mt-3 rounded-lg bg-emerald-50 p-3"><p className="flex items-center gap-2 text-sm font-semibold text-emerald-950"><Clock3 size={15} />{durationText(remaining)} simulated time remaining</p><p className="mt-1 text-xs text-emerald-900">Expiry {stamp(activeOverride.expiresAt)}. Countdown advances with the simulation clock, not while the simulator is paused.</p></div>
            </article> : <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Override state</h2><p className="mt-2 text-sm text-slate-600">This shipment is in automatic mode. Applying a preset or custom target records the operator action and its reason.</p></article>}

            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Recent override history</h2>
              {overrides.length ? <ol className="mt-3 space-y-2">{overrides.slice(0, 5).map(item => <li key={item.overrideId} className="flex flex-wrap justify-between gap-2 border-b border-slate-200 pb-2 text-sm"><span className="font-medium">{item.presetId ? presets.find(preset => preset.id === item.presetId)?.name || item.presetId : "Custom override"} · {item.status}</span><span className="text-xs text-slate-500">{stamp(item.createdAt)}{item.releasedAt ? ` · ended ${stamp(item.releasedAt)}` : ""}</span></li>)}</ol> : <p className="mt-2 text-sm text-slate-600">No overrides have been recorded for this shipment.</p>}
            </article>
          </section>
        </div>
      </> : null}
    </div>
  </main>;
}

function Metric({ icon: Icon, label, value }) {
  return <div className="rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-600"><Icon size={15} />{label}</div><div className="mt-1 text-lg font-bold text-slate-900">{value}</div></div>;
}

function PolicyScale({ min, max, safeMin, safeMax, label }) {
  const left = Math.max(0, Math.min(100, (Number(safeMin) - min) / (max - min) * 100));
  const right = Math.max(left, Math.min(100, (Number(safeMax) - min) / (max - min) * 100));
  return <div role="img" aria-label={`${label}: ${safeMin} to ${safeMax}; physical range ${min} to ${max}`} className="relative mt-2 h-5">
    <div className="absolute left-0 right-0 top-1.5 h-1.5 rounded-full bg-slate-200" />
    <div className="absolute top-1.5 h-1.5 rounded-full bg-emerald-600" style={{ left: `${left}%`, width: `${right - left}%` }} />
    <span className="absolute top-3 text-[10px] font-semibold text-emerald-800" style={{ left: `${left}%`, transform: "translateX(-50%)" }}>{safeMin}</span>
    <span className="absolute top-3 text-[10px] font-semibold text-emerald-800" style={{ left: `${right}%`, transform: "translateX(-50%)" }}>{safeMax}</span>
  </div>;
}
