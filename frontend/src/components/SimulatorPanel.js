import React, { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../services/simulator";
const initial = { deviceId: "", vehicleId: "", batchId: "", shipmentId: "", seed: "1", scenario: "NORMAL",
  startTime: "2026-01-01T00:00:00.000Z", tickIntervalMs: "60000", min: "", max: "", initialBatteryLevel: "100", route: "" };

export default function SimulatorPanel() {
  const [form, setForm] = useState(initial);
  const [inputs, setInputs] = useState({ batches: [], shipments: [], scenarios: [] });
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [monitor, setMonitor] = useState(null);
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const [options, statuses] = await Promise.all([api.fetchSimulatorInputs(), api.fetchSimulatorStatuses()]);
      setInputs(options); setDevices(statuses.simulations || []);
      setMonitor(statuses.monitor || null);
    } catch (e) { setError(e.response?.data?.error || "Simulator unavailable. Check your session and backend."); }
    finally { loading.current = false; }
  }, []);
  useEffect(() => { load(); const timer = setInterval(load, 5000); return () => clearInterval(timer); }, [load]);
  const change = (name, value) => setForm(prev => ({ ...prev, [name]: value, ...(name === "batchId" ? { shipmentId: "" } : {}) }));
  async function execute(label, work) {
    setBusy(label); setError("");
    try { await work(); await load(); }
    catch (e) { setError(String(e.response?.data?.error || e.message)); }
    finally { setBusy(""); }
  }
  const create = event => {
    event.preventDefault();
    execute("create", async () => {
      const { min, max, route, ...config } = form;
      await api.createVirtualDevice({ ...config, tickIntervalMs: Number(config.tickIntervalMs), initialBatteryLevel: Number(config.initialBatteryLevel),
        temperatureRange: { min: Number(min), max: Number(max) }, ...(route.trim() ? { route: JSON.parse(route) } : {}) });
    });
  };
  const selectedBatch = inputs.batches.find(batch => batch.batchId === form.batchId);
  const field = (name, label, type = "text") => <label className="block text-sm" key={name}>{label}
    <input className="mt-1 w-full rounded border p-2" type={type} value={form[name]} required={!['vehicleId'].includes(name)}
      step={type === "number" ? "any" : undefined} onChange={e => change(name, e.target.value)} /></label>;
  return <section aria-label="Virtual IoT simulator" className="my-4 rounded-xl border bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Virtual IoT simulator</h2><button type="button" onClick={load}>Refresh devices</button></div>
    <p className="my-2 text-sm text-slate-600">Software-only, seeded readings. Generator ranges are not medical policies. Device state is saved; restart recovery is stopped until explicitly resumed.</p>
    {error && <p role="alert" className="my-2 text-red-700">{error}</p>}
    {monitor?.lastError && <p role="alert" className="text-red-700">{monitor.lastError}</p>}
    <form onSubmit={create} className="grid gap-3 md:grid-cols-3">
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
      <button disabled={Boolean(busy)} className="rounded bg-blue-700 px-4 py-2 text-white" type="submit">Create virtual device</button>
    </form>
    <div className="mt-4 space-y-3">{devices.map(device => <article className="rounded border p-3" key={device.deviceId}>
      <h3 className="font-semibold">{device.deviceId} — {device.running ? "Running" : "Stopped"}</h3>
      <p className="text-sm">Batch: {device.batchId || "unassociated"} · Vehicle: {device.vehicleId || "—"} · Ticks: {device.ticksGenerated} · Battery: {device.batteryLevel}%</p>
      <p className="text-sm">Next simulation time: {device.nextTimestamp}</p>
      {device.lastReading && <p className="text-sm">Latest: {device.lastReading.temperature}°C · {device.lastReading.humidity}% humidity · GPS {device.lastReading.latitude}, {device.lastReading.longitude}</p>}
      {device.lastError && <p className="text-sm text-red-700">{device.lastError}{device.pendingRetry ? " Tick once to retry the saved reading." : ""}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{[["Start", api.startSimulation], ["Stop", api.stopSimulation], ["Tick once", api.tickSimulation], ["Reset", api.resetSimulation]].map(([label, action]) =>
        <button className="rounded border px-3 py-1 disabled:opacity-50" key={label} disabled={Boolean(busy)} type="button" onClick={() => execute(`${device.deviceId}:${label}`, () => action(device.deviceId))}>{label}</button>)}
        <select aria-label={`Scenario for ${device.deviceId}`} disabled={Boolean(busy) || device.pendingRetry} value={device.scenario}
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
