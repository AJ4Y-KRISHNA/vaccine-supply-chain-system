import React, { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../services/simulator";
const initial = { deviceId: "", vehicleId: "", batchId: "", shipmentId: "", seed: "1", scenario: "NORMAL",
  startTime: new Date().toISOString(), tickIntervalMs: "5000", min: "", max: "", initialBatteryLevel: "100", route: "" };

export default function SimulatorPanel() {
  const [form, setForm] = useState(initial);
  const [inputs, setInputs] = useState({ batches: [], shipments: [], scenarios: [] });
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState("");
  const [monitor, setMonitor] = useState(null);
  const loading = useRef(null);
  const actionInFlight = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) return loading.current;
    setRefreshing(true);
    loading.current = (async () => { try {
      const [options, statuses] = await Promise.all([api.fetchSimulatorInputs(), api.fetchSimulatorStatuses()]);
      setInputs(options); setDevices(statuses.simulations || []);
      setMonitor(statuses.monitor || null);
      setLoadError("");
    } catch (e) { setLoadError(String(e.response?.data?.error || "Simulator unavailable. Check your session and backend.")); }
    finally { loading.current = null; setRefreshing(false); } })();
    return loading.current;
  }, []);
  useEffect(() => { load(); const timer = setInterval(() => { if (!actionInFlight.current && document.visibilityState !== "hidden") load(); }, 5000); return () => clearInterval(timer); }, [load]);
  const change = (name, value) => setForm(prev => ({ ...prev, [name]: value, ...(name === "batchId" ? { shipmentId: "" } : {}) }));
  async function execute(label, work) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(label); setError(""); setMessage("");
    try {
      const result = await work();
      setMessage(result?.message || "Simulator updated.");
      // A poll begun before the mutation must not become the final displayed status.
      if (loading.current) await loading.current;
      await load();
    }
    catch (e) { setError(String(e.response?.data?.error || e.message)); }
    finally { actionInFlight.current = false; setBusy(""); }
  }
  const create = event => {
    event.preventDefault();
    execute("create", async () => {
      const { min, max, route, ...config } = form;
      if (!config.deviceId.trim() || !config.batchId || !config.seed.trim()) throw new Error("Enter a device ID, batch and fixed seed.");
      if (devices.some(device => device.deviceId === config.deviceId.trim())) throw new Error("Device already exists. Use its controls below or choose a new device ID.");
      if (!/^\d{4}-\d{2}-\d{2}T/.test(config.startTime) || !Number.isFinite(Date.parse(config.startTime))) throw new Error("Enter a valid ISO simulation start, for example 2026-01-01T00:00:00.000Z.");
      if (!Number.isInteger(Number(config.tickIntervalMs)) || Number(config.tickIntervalMs) < 10 || Number(config.tickIntervalMs) > 3600000) throw new Error("Tick interval must be a whole number between 10 and 3600000 milliseconds.");
      if (!min.trim() || !max.trim() || !Number.isFinite(Number(min)) || !Number.isFinite(Number(max)) || Number(min) >= Number(max) || Number(min) < -100 || Number(max) > 100) throw new Error("Generator minimum must be below maximum, within -100 to 100°C.");
      if (config.initialBatteryLevel === "" || !Number.isFinite(Number(config.initialBatteryLevel)) || Number(config.initialBatteryLevel) < 0 || Number(config.initialBatteryLevel) > 100) throw new Error("Initial battery must be between 0 and 100 percent.");
      let points;
      if (route.trim()) {
        try { points = JSON.parse(route); } catch (_) { throw new Error("GPS route must be valid JSON containing latitude/longitude points."); }
        if (!Array.isArray(points) || points.length < 2 || points.length > 1000 || points.some(point => !point || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180)) throw new Error("GPS route needs 2–1000 points with latitude -90 to 90 and longitude -180 to 180.");
      }
      return api.createVirtualDevice({ ...config, deviceId: config.deviceId.trim(), vehicleId: config.vehicleId.trim(), seed: config.seed.trim(), tickIntervalMs: Number(config.tickIntervalMs), initialBatteryLevel: Number(config.initialBatteryLevel),
        temperatureRange: { min: Number(min), max: Number(max) }, ...(points ? { route: points } : {}) });
    });
  };
  const selectedBatch = inputs.batches.find(batch => batch.batchId === form.batchId);
  const field = (name, label, type = "text") => <label className="block text-sm" key={name}>{label}
    <input className="mt-1 w-full min-w-0 rounded border p-2" type={type} value={form[name]} required={!['vehicleId'].includes(name)} disabled={Boolean(busy)}
      step={type === "number" ? "any" : undefined} onChange={e => change(name, e.target.value)} /></label>;
  return <section aria-label="Virtual IoT simulator" className="my-4 rounded-xl border bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Virtual IoT simulator</h2><button className="rounded-lg border px-3 py-2 disabled:opacity-50" type="button" onClick={load} disabled={refreshing || Boolean(busy)}>{refreshing ? "Refreshing devices…" : "Refresh devices"}</button></div>
    <p className="my-2 text-sm text-slate-600">Software-only, seeded readings. All device timestamps use a synthetic simulation clock and may differ from your computer’s current time. Generator ranges are not medical policies. Device state is saved; restart recovery is stopped until explicitly resumed.</p>
    {error && <p role="alert" className="my-2 text-red-700">{error}</p>}
    {loadError && <p role="alert" className="my-2 text-red-700">{loadError}</p>}
    {message && <p role="status" className="my-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {monitor?.lastError && <p role="alert" className="text-red-700">{monitor.lastError}</p>}
    <form onSubmit={create}><fieldset disabled={Boolean(busy)} className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {field("deviceId", "Device ID")}{field("vehicleId", "Vehicle ID")}
      <label>Batch<select aria-label="Simulator batch" className="mt-1 w-full rounded border p-2" required value={form.batchId} onChange={e => change("batchId", e.target.value)}>
        <option value="">Select existing batch</option>{inputs.batches.map(b => <option key={b.batchId} value={b.batchId}>{b.batchId}{b.isDemo ? " (demo)" : ""}</option>)}</select></label>
      <label>Shipment<select aria-label="Simulator shipment" className="mt-1 w-full rounded border p-2" value={form.shipmentId} onChange={e => change("shipmentId", e.target.value)}>
        <option value="">Batch only</option>{inputs.shipments.filter(s => s.batchId === form.batchId).map(s => <option key={s.shipmentId} value={s.shipmentId}>{s.shipmentId}</option>)}</select></label>
      <label>Scenario<select aria-label="Create scenario" className="mt-1 w-full rounded border p-2" value={form.scenario} onChange={e => change("scenario", e.target.value)}>
        {inputs.scenarios.map(s => <option key={s}>{s}</option>)}</select></label>
      {field("seed", "Fixed seed")}{field("startTime", "Simulation start (ISO)")}{field("tickIntervalMs", "Tick interval (milliseconds)", "number")}
      {field("initialBatteryLevel", "Initial battery (%)", "number")}{field("min", "Generator minimum (°C)", "number")}{field("max", "Generator maximum (°C)", "number")}
      <label>Optional GPS route (JSON)<textarea className="mt-1 w-full rounded border p-2" value={form.route} onChange={e => change("route", e.target.value)} placeholder='[{"latitude":9.93,"longitude":76.26},{"latitude":9.95,"longitude":76.28}]' /></label>
      {selectedBatch && !selectedBatch.coldChainPolicyId && <p className="text-sm text-amber-800 md:col-span-3">This batch has no approved cold-chain policy. Readings will be stored without a safety evaluation.</p>}
      <button disabled={Boolean(busy) || !inputs.batches.length} className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50" type="submit">{busy === "create" ? "Creating device…" : "Create virtual device"}</button>
      {!refreshing && !inputs.batches.length && !loadError && <p className="text-sm text-slate-600 sm:col-span-2">Create an owned batch first, then refresh devices to select it here.</p>}
    </fieldset></form>
    <div className="mt-4 space-y-3">{devices.map(device => <article className="rounded border p-3" key={device.deviceId}>
      <h3 className="break-words font-semibold">{device.deviceId} — {device.running ? "Running" : "Stopped"}</h3>
      <p className="text-sm">Batch: {device.batchId || "unassociated"} · Vehicle: {device.vehicleId || "—"} · Ticks: {device.ticksGenerated} · Battery: {device.batteryLevel}%</p>
      <p className="text-sm"><span className="font-semibold">Next simulated reading:</span> {device.nextTimestamp || "Unavailable"}</p>
      {device.lastReading && <p className="text-sm">Latest: {device.lastReading.temperature}°C · {device.lastReading.humidity}% humidity · GPS {device.lastReading.latitude}, {device.lastReading.longitude}</p>}
      {device.lastError && <p className="text-sm text-red-700">{device.lastError}{device.pendingRetry ? " Tick once to retry the saved reading." : ""}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{[["Start", api.startSimulation], ["Stop", api.stopSimulation], ["Tick once", api.tickSimulation], ["Reset", api.resetSimulation]].map(([label, action]) =>
        <button className="rounded-lg border px-3 py-2 disabled:opacity-50" key={label} disabled={Boolean(busy) || (label === "Start" && device.running) || (label === "Stop" && !device.running) || (label === "Reset" && device.pendingRetry)} type="button" onClick={() => execute(`${device.deviceId}:${label}`, () => action(device.deviceId))}>{busy === `${device.deviceId}:${label}` ? "Working…" : label}</button>)}
        <select aria-label={`Scenario for ${device.deviceId}`} disabled={Boolean(busy) || device.pendingRetry} value={device.scenario}
          className="max-w-full rounded-lg border px-3 py-2"
          onChange={event => execute(device.deviceId, () => api.changeSimulationScenario(device.deviceId, event.target.value))}>
          {inputs.scenarios.map(s => <option key={s}>{s}</option>)}
        </select>
      </div><p className="mt-2 text-xs text-slate-500">Reset rewinds only the generator. Saved telemetry, policy, alerts and quality holds remain.</p>
      <label className="mt-2 block text-sm"><input type="checkbox" checked={Boolean(device.monitoring?.enabled)} disabled={Boolean(busy)}
        onChange={event => execute(device.deviceId, () => api.setSimulationMonitoring(device.deviceId, event.target.checked))} /> Arm automatic silence monitoring</label>
      <p className="text-xs text-slate-500">Opt-in clock advances from the last tick position at 1× elapsed time, even while stopped or after restart. Pause monitoring for intentional pauses. Late readings remain historical; recovery needs fresh simulation timestamps. No hold is cleared by pausing.</p>
    </article>)}</div>
  </section>;
}
