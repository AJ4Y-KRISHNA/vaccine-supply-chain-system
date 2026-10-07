import React, { useState } from "react";
import { Activity, FileUp, Send } from "lucide-react";
import API from "../services/api";
import SourceBadge from "./SourceBadge";

const empty = { batchId: "", vehicleId: "", temperature: "", humidity: "", battery: "", lat: "", lon: "", timestamp: new Date().toISOString().slice(0, 16), note: "" };
const csvTemplate = () => `batchId,vehicleId,temperature,humidity,battery,lat,lon,timestamp,note\nSYNTHETIC-BATCH-001,TRUCK-01,5.2,58,92,9.9312,76.2673,${new Date().toISOString()},Synthetic manual inspection reading\n`;

export default function ManualReadingEntry({ allowManual = true }) {
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState([]);
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const payload = { ...form, temperature: Number(form.temperature), humidity: Number(form.humidity), battery: Number(form.battery), lat: Number(form.lat), lon: Number(form.lon), timestamp: new Date(form.timestamp).toISOString() };
      const result = (await API.post("/readings/manual", payload)).data;
      setMessage(`Manual reading queued${result.needsReview ? " · needs review (rapid temperature change)" : ""}. Policy evaluation and anchoring run through the shared pipeline.`);
      setForm(current => ({ ...empty, batchId: current.batchId, vehicleId: current.vehicleId }));
    } catch (failure) { setError(failure.response?.data?.error || "Could not submit reading"); }
    finally { setBusy(false); }
  };
  const importCsv = async event => {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setError(""); setMessage("");
    try { const result = (await API.post("/readings/import", file, { headers: { "Content-Type": "text/csv" } })).data;
      setReport(result.results || []); setMessage(`CSV import finished: ${result.accepted} accepted, ${result.rejected} rejected. Accepted readings enter the shared telemetry pipeline.`);
    } catch (failure) { setError(failure.response?.data?.error || "Could not import CSV"); }
    finally { setBusy(false); event.target.value = ""; }
  };
  const downloadTemplate = () => { const url = URL.createObjectURL(new Blob([csvTemplate()], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "synthetic-reading-template.csv"; link.click(); URL.revokeObjectURL(url); };
  return <section aria-label="Manual telemetry entry" className="my-5 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Activity size={18} />Manual / CSV telemetry</h2><p className="text-sm text-slate-600">Synthetic software-demo readings enter the same validation, alert, notification and anchoring pipeline.</p></div><SourceBadge source="manual" /></div>
    {error && <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}{message && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    {allowManual ? <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Batch ID" name="batchId" value={form.batchId} onChange={update} required /> <Field label="Vehicle ID" name="vehicleId" value={form.vehicleId} onChange={update} required />
      <Field label="Temperature (°C)" name="temperature" value={form.temperature} onChange={update} type="number" min="-40" max="60" step="0.1" required /> <Field label="Humidity (%)" name="humidity" value={form.humidity} onChange={update} type="number" min="0" max="100" step="0.1" required />
      <Field label="Battery (%)" name="battery" value={form.battery} onChange={update} type="number" min="0" max="100" step="0.1" required /> <Field label="Latitude" name="lat" value={form.lat} onChange={update} type="number" min="-90" max="90" step="any" required />
      <Field label="Longitude" name="lon" value={form.lon} onChange={update} type="number" min="-180" max="180" step="any" required /> <Field label="Timestamp" name="timestamp" value={form.timestamp} onChange={update} type="datetime-local" required />
      <label className="sm:col-span-2 lg:col-span-3"><span className="mb-1 block text-xs font-semibold text-slate-600">Operator note (required)</span><input name="note" value={form.note} onChange={update} required maxLength={1000} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Reason for this manual measurement" /></label>
      <div className="flex items-end"><button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Send size={15} />{busy ? "Submitting…" : "Submit reading"}</button></div>
    </form> : <p className="mb-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Healthcare users can import a CSV record here. Manual sensor entry is available to Admin, Distributor and Field Operator roles.</p>}
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={downloadTemplate} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Download CSV template</button><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"><FileUp size={15} />Upload CSV (max 5,000 rows)<input type="file" accept=".csv,text/csv" onChange={importCsv} disabled={busy} className="sr-only" /></label></div>
    {report.length > 0 && <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">CSV row</th><th className="p-2">Result</th><th className="p-2">Source</th><th className="p-2">Details</th></tr></thead><tbody>{report.map(item => <tr key={item.row} className="border-t"><td className="p-2">{item.row}</td><td className="p-2">{item.status}</td><td className="p-2"><SourceBadge source={item.source || "csv"} /></td><td className="p-2">{item.reason || (item.needsReview ? "Accepted · needs review" : item.readingId || "Accepted")}</td></tr>)}</tbody></table></div>}
    <p className="mt-3 text-xs text-slate-500">All records are synthetic. Manual timestamps cannot be future-dated; unusually rapid changes are flagged for review rather than suppressed.</p>
  </section>;
}
function Field({ label, ...props }) { return <label><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span><input {...props} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>; }
