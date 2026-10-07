import React, { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler } from "chart.js";
import API from "../services/api";
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

export default function ForecastAnalyticsPanel({ role = "manufacturer" }) {
  const [catalog, setCatalog] = useState([]), [selected, setSelected] = useState("");
  const [horizon, setHorizon] = useState(6), [run, setRun] = useState(null);
  const [plan, setPlan] = useState(null), [approval, setApproval] = useState(null);
  const [reason, setReason] = useState(""), [capacity, setCapacity] = useState(1000);
  const [transport, setTransport] = useState(1000), [shelfLife, setShelfLife] = useState(30);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    API.get("/forecast").then(({ data }) => { if (active) { setCatalog(data.catalog); setSelected(data.catalog.length ? "0" : ""); } })
      .catch(e => { if (active) setError(e.response?.data?.error || "Forecast history unavailable"); });
    return () => { active = false; };
  }, []);
  const action = async callback => {
    setBusy(true); setError("");
    try { await callback(); } catch (e) { setError(e.response?.data?.error || "Analytics request failed"); }
    finally { setBusy(false); }
  };
  const resetPlan = () => { setPlan(null); setApproval(null); };
  const load = () => action(async () => {
    const item = catalog[Number(selected)];
    const { data } = await API.get("/forecast", { params: { vaccineType: item.vaccineType, region: item.region, horizon } });
    setRun(data); setPlan(null); setApproval(null);
  });
  const download = () => action(async () => {
    const { data } = await API.get(`/forecast/${run.runId}/metrics`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `synthetic-forecast-${run.runId}.json`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const forecast = run?.forecast;
  const n = forecast?.history.length || 0;
  const chart = forecast && { labels: [...forecast.history_periods, ...forecast.forecast_periods.map(p => p.period)], datasets: [
    { label: "Recorded synthetic demand", data: [...forecast.history, ...Array(horizon).fill(null)], borderColor: "#64748b", pointRadius: 2 },
    { label: "Forecast", data: [...Array(n).fill(null), ...forecast.forecast_periods.map(p => p.demand_doses)], borderColor: "#059669", pointRadius: 3 },
    { label: "95% lower bound", data: [...Array(n).fill(null), ...forecast.forecast_periods.map(p => p.lower)], borderColor: "#a7f3d0", pointRadius: 0 },
    { label: "95% upper bound", data: [...Array(n).fill(null), ...forecast.forecast_periods.map(p => p.upper)], borderColor: "#a7f3d0", backgroundColor: "rgba(16,185,129,0.15)", fill: "-1", pointRadius: 0 },
  ] };
  return <section id="forecast-analytics" className="my-5 rounded-xl border border-slate-200 bg-white p-5 text-slate-700">
    <h2 className="text-xl font-semibold">Demand forecasting & distribution recommendations</h2>
    <p className="my-2 text-sm">Synthetic software simulation only — not clinical or production guidance. Policy alerts remain authoritative; analytics never dispatch automatically.</p>
    {error && <p role="alert" className="my-2 text-red-700">{error}</p>}
    <div className="my-4 flex flex-wrap items-end gap-3">
      <label>Vaccine / region<select aria-label="Vaccine and region" className="block rounded border p-2" value={selected} onChange={e => { setSelected(e.target.value); setRun(null); setPlan(null); setApproval(null); }}>
        {!catalog.length && <option value="">No synthetic order history</option>}
        {catalog.map((row, i) => <option key={`${row.vaccineType}-${row.region}`} value={i}>{row.vaccineType} — {row.region} ({row.months} months)</option>)}
      </select></label>
      <label>Horizon<select aria-label="Forecast horizon" className="block rounded border p-2" value={horizon} onChange={e => { setHorizon(Number(e.target.value)); setRun(null); setPlan(null); }}><option value={3}>3 months</option><option value={6}>6 months</option></select></label>
      <button disabled={busy || selected === "" || !catalog[Number(selected)]?.ready} onClick={load} className="rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">Generate forecast</button>
      <button disabled={busy} className="rounded border px-4 py-2" onClick={() => action(async () => {
        const { data } = await API.get("/forecast"); setCatalog(data.catalog); setSelected(data.catalog.length ? "0" : ""); setRun(null); resetPlan();
      })}>Refresh forecast history</button>
    </div>
    {!catalog.length && <p>Seed the synthetic monthly order history first. The comparison needs 30 observed complete months per vaccine and region.</p>}
    {forecast && <>
      <p className="font-medium">synthetic history, {forecast.provenance.observation_count} months — {forecast.provenance.vaccine_type}, {forecast.provenance.region}</p>
      <p className="text-sm">Selected: {forecast.model}. {forecast.interval_method}. {forecast.provenance.note}</p>
      <div className="my-4 h-72"><Line data={chart} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: "Doses / month" } } } }} /></div>
      <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Model</th><th>RMSE (doses)</th><th>MAPE (%)</th><th>Evaluation</th></tr></thead><tbody>
        {forecast.comparison.map((row, i) => <tr key={i}><td className="py-2">{row.model}</td><td>{row.rmse?.toFixed(2) ?? "—"}</td><td>{row.mape?.toFixed(2) ?? "—"}</td><td>{row.status}{row.reason && `: ${row.reason}`}</td></tr>)}
      </tbody></table></div>
      {forecast.limitations.map(text => <p key={text} className="my-1 text-xs">{text}</p>)}
      <button onClick={download} disabled={busy} className="my-3 rounded border px-4 py-2">Download thesis metrics JSON</button>
      {role === "admin" && <div className="mt-4 border-t pt-4">
        <h3 className="font-semibold">Forecast-based supply plan — first forecast month</h3>
        <div className="my-3 flex flex-wrap gap-3">
          <label>Region capacity (doses)<input aria-label="Region capacity" type="number" min="0" max="10000000" className="block rounded border p-2" value={capacity} onChange={e => { setCapacity(Number(e.target.value)); resetPlan(); }} /></label>
          <label>Transport capacity (doses)<input aria-label="Transport capacity" type="number" min="0" max="10000000" className="block rounded border p-2" value={transport} onChange={e => { setTransport(Number(e.target.value)); resetPlan(); }} /></label>
          <label>Minimum remaining shelf life (days)<input aria-label="Minimum shelf life" type="number" min="0" max="365" className="block rounded border p-2" value={shelfLife} onChange={e => { setShelfLife(Number(e.target.value)); resetPlan(); }} /></label>
        </div>
        <button disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-white" onClick={() => action(async () => {
          setApproval(null); setPlan(null); const { data } = await API.post("/admin/forecast-plan", { runIds: [run.runId], destinationCapacity: capacity, transportCapacity: transport, minimumShelfLifeDays: shelfLife }); setPlan(data);
        })}>Compute recommendation</button>
        {plan && <div className="my-4 space-y-2">
          <p>Allocated recommendation: {plan.allocatedDoses} doses. Solver: {plan.method}</p>
          {plan.allocations.map(row => <p key={`${row.batchId}-${row.region}`}>{row.batchId} → {row.region}: {row.doses} doses</p>)}
          {plan.unfilled.map(row => <p key={`${row.vaccineType}-${row.region}`}>Unfilled {row.vaccineType}, {row.region}: {row.doses} doses</p>)}
          {plan.exclusions.map(row => <p key={row.batchId} className="text-sm">Excluded {row.batchId}: {row.reasons.join(", ")}</p>)}
          {plan.assumptions.map(text => <p key={text} className="text-xs">{text}</p>)}
          <label className="block">Review reason<textarea aria-label="Review reason" value={reason} onChange={e => setReason(e.target.value)} className="block w-full rounded border p-2" /></label>
          <button disabled={busy || !!approval || reason.trim().length < 10} className="rounded border border-emerald-700 px-4 py-2" onClick={() => action(async () => { const { data } = await API.post(`/admin/forecast-plan/${plan.planId}/approve`, { reason }); setApproval(data); })}>Approve recommendation for review record</button>
          {approval && <p role="status">Review approved. Stock unchanged; no dispatch. Use the existing authorized order workflow for allocation.</p>}
        </div>}
      </div>}
    </>}
  </section>;
}
