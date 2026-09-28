import React, { useState } from "react";
import { approveColdChainPolicy, fetchColdChainPolicy, checkColdChainTelemetry } from "../services/alerts";

const numericFields = [
  ["minimumTemperature", "Minimum temperature (°C)"], ["maximumTemperature", "Maximum temperature (°C)"],
  ["minimumHumidity", "Minimum humidity (%) — optional"], ["maximumHumidity", "Maximum humidity (%) — optional"],
  ["excursionDurationMs", "Sustained excursion duration (milliseconds)"], ["maximumReadingGapMs", "Maximum reading gap (milliseconds)"],
  ["criticalBatteryPercent", "Critical battery (%)"], ["maximumRateCelsiusPerMinute", "Maximum plausible change (°C/minute)"],
];
export default function ColdChainPolicyForm({ canReview, onChange }) {
  const [batchId, setBatchId] = useState("");
  const [values, setValues] = useState({});
  const [asOf, setAsOf] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [policy, setPolicy] = useState(null);
  const run = async fn => {
    setBusy(true); setMessage("");
    try { await fn(); } catch (error) { setMessage(String(error?.response?.data?.error || error.message)); }
    finally { setBusy(false); }
  };
  const approve = event => {
    event.preventDefault();
    run(async () => {
      const body = { ...values };
      for (const [key] of numericFields) {
        if (body[key] === "" || body[key] === undefined) delete body[key]; else body[key] = Number(body[key]);
      }
      const result = await approveColdChainPolicy(batchId.trim(), body);
      setPolicy(result.policy); setMessage("Approved policy revision recorded. Existing history is unchanged."); onChange();
    });
  };
  return <details className="my-4 rounded-lg border p-3 text-sm">
    <summary className="cursor-pointer font-semibold">Batch storage policy and simulation clock</summary>
    <p className="my-2">Enter limits from the approved product/storage policy. Blank fields have no universal medical defaults. Confidence describes telemetry evidence, not vaccine safety.</p>
    <label className="block">Policy batch ID<input className="ml-2 rounded border p-1" value={batchId} onChange={e => { setBatchId(e.target.value); setPolicy(null); }} /></label>
    <button type="button" className="my-2 rounded border px-3 py-1" disabled={busy || !batchId.trim()} onClick={() => run(async () => {
      const result = await fetchColdChainPolicy(batchId.trim()); setPolicy(result.policy); setMessage(result.policyStatus);
    })}>Inspect policy</button>
    {policy ? <p>Revision {policy._id}: {policy.minimumTemperature}–{policy.maximumTemperature}°C; humidity {policy.minimumHumidity != null && policy.maximumHumidity != null ? `${policy.minimumHumidity}–${policy.maximumHumidity}%` : "not configured (checks skipped)"}; sustained duration {policy.excursionDurationMs}ms; source: {policy.sourceReference}</p> : null}
    {canReview ? <form onSubmit={approve} className="my-3 grid gap-3 md:grid-cols-2">
      <p className="md:col-span-2">Humidity monitoring is optional for existing policies. Enter both humidity limits to enable humidity checks; leave both blank to skip them.</p>
      {numericFields.map(([key, label]) => <label key={key} className="flex flex-col">{label}<input aria-label={label} type="number" step="any" required={!key.includes("Humidity")} value={values[key] ?? ""} onChange={e => setValues({ ...values, [key]: e.target.value })} className="rounded border p-2" /></label>)}
      <label className="flex flex-col">Approved policy source/reference<input required minLength={3} value={values.sourceReference || ""} onChange={e => setValues({ ...values, sourceReference: e.target.value })} className="rounded border p-2" /></label>
      <label className="flex flex-col">Policy approval reason<input required minLength={3} value={values.approvalReason || ""} onChange={e => setValues({ ...values, approvalReason: e.target.value })} className="rounded border p-2" /></label>
      <button disabled={busy || !batchId.trim()} className="rounded bg-blue-700 p-2 text-white">Approve new policy revision</button>
    </form> : <p className="my-2">A designated quality reviewer must approve policies and clear holds.</p>}
    <label className="block">Current simulation clock (ISO timestamp)<input placeholder="YYYY-MM-DDTHH:mm:ss.sssZ" value={asOf} onChange={e => setAsOf(e.target.value)} className="ml-2 rounded border p-1" /></label>
    <button type="button" className="my-2 rounded border px-3 py-1" disabled={busy || !batchId.trim() || !asOf} onClick={() => run(async () => {
      const result = await checkColdChainTelemetry(batchId.trim(), asOf); setMessage(`Clock check completed: ${result.alerts.length} missing-telemetry events updated.`); onChange();
    })}>Check missing telemetry</button>
    {message ? <p role="status" className="mt-2">{message}</p> : null}
  </details>;
}
