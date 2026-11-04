import React, { useRef, useState } from "react";
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
  const inFlight = useRef(false);
  const run = async fn => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage("");
    try { await fn(); } catch (error) { setMessage(String(error?.response?.data?.error || error.message)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const refreshAfterSave = async () => {
    try { await onChange?.(); }
    catch (_) { setMessage(current => `${current} Dashboard refresh failed; use Refresh. Do not repeat the saved action.`); }
  };
  const approve = event => {
    event.preventDefault();
    run(async () => {
      const body = { ...values };
      for (const [key] of numericFields) {
        if (body[key] === "" || body[key] === undefined) delete body[key]; else body[key] = Number(body[key]);
      }
      if (!batchId.trim()) throw new Error("Enter the policy batch ID.");
      if (!Number.isFinite(body.minimumTemperature) || !Number.isFinite(body.maximumTemperature) || body.minimumTemperature >= body.maximumTemperature) throw new Error("Minimum temperature must be below maximum temperature.");
      if ((body.minimumHumidity === undefined) !== (body.maximumHumidity === undefined)) throw new Error("Enter both humidity limits, or leave both blank.");
      if (body.minimumHumidity !== undefined && (body.minimumHumidity < 0 || body.maximumHumidity > 100 || body.minimumHumidity >= body.maximumHumidity)) throw new Error("Humidity limits must increase within 0 to 100 percent.");
      if (![body.excursionDurationMs, body.maximumReadingGapMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Excursion duration and reading gap must be positive whole milliseconds.");
      if (!Number.isFinite(body.criticalBatteryPercent) || body.criticalBatteryPercent < 0 || body.criticalBatteryPercent > 100 || !Number.isFinite(body.maximumRateCelsiusPerMinute) || body.maximumRateCelsiusPerMinute <= 0) throw new Error("Enter a battery threshold from 0 to 100 and a positive plausible rate of change.");
      body.sourceReference = (body.sourceReference || "").trim(); body.approvalReason = (body.approvalReason || "").trim();
      if (body.sourceReference.length < 3 || body.approvalReason.length < 3) throw new Error("Enter the approved policy reference and approval reason (at least 3 characters each).");
      const result = await approveColdChainPolicy(batchId.trim(), body);
      setPolicy(result.policy); setValues({}); setMessage("Approved policy revision recorded. Existing history is unchanged."); await refreshAfterSave();
    });
  };
  return <details className="my-4 rounded-lg border p-3 text-sm">
    <summary className="cursor-pointer font-semibold">Batch storage policy and simulation clock</summary>
    <p className="my-2">Enter limits from the approved product/storage policy. Blank fields have no universal medical defaults. Confidence describes telemetry evidence, not vaccine safety.</p>
    <label className="block">Policy batch ID<input className="mt-1 block w-full rounded border p-2" maxLength={120} disabled={busy} value={batchId} onChange={e => { setBatchId(e.target.value); setPolicy(null); setValues({}); setAsOf(""); setMessage(""); }} /></label>
    <button type="button" className="my-2 rounded border px-3 py-1" disabled={busy || !batchId.trim()} onClick={() => run(async () => {
      const result = await fetchColdChainPolicy(batchId.trim()); setPolicy(result.policy); setMessage(result.policyStatus);
    })}>Inspect policy</button>
    {policy ? <p>Revision {policy._id}: {policy.minimumTemperature}–{policy.maximumTemperature}°C; humidity {policy.minimumHumidity != null && policy.maximumHumidity != null ? `${policy.minimumHumidity}–${policy.maximumHumidity}%` : "not configured (checks skipped)"}; sustained duration {policy.excursionDurationMs}ms; source: {policy.sourceReference}</p> : null}
    {canReview ? <form onSubmit={approve}><fieldset disabled={busy} className="my-3 grid min-w-0 gap-4 md:grid-cols-2">
      <p className="md:col-span-2">Humidity monitoring is optional for existing policies. Enter both humidity limits to enable humidity checks; leave both blank to skip them.</p>
      {numericFields.map(([key, label]) => <label key={key} className="flex flex-col">{label}<input aria-label={label} type="number" step="any" required={!key.includes("Humidity")} value={values[key] ?? ""} onChange={e => setValues({ ...values, [key]: e.target.value })} className="rounded border p-2" /></label>)}
      <label className="flex flex-col">Approved policy source/reference<input required minLength={3} value={values.sourceReference || ""} onChange={e => setValues({ ...values, sourceReference: e.target.value })} className="rounded border p-2" /></label>
      <label className="flex flex-col">Policy approval reason<input required minLength={3} value={values.approvalReason || ""} onChange={e => setValues({ ...values, approvalReason: e.target.value })} className="rounded border p-2" /></label>
      <button disabled={busy || !batchId.trim()} className="rounded bg-blue-700 p-2 text-white">Approve new policy revision</button>
    </fieldset></form> : <p className="my-2">A designated quality reviewer must approve policies and clear holds.</p>}
    <label className="block">Current simulation clock (ISO timestamp)<input placeholder="YYYY-MM-DDTHH:mm:ss.sssZ" disabled={busy} value={asOf} onChange={e => setAsOf(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
    <button type="button" className="my-2 rounded border px-3 py-1" disabled={busy || !batchId.trim() || !asOf} onClick={() => run(async () => {
      if (!/^\d{4}-\d{2}-\d{2}T/.test(asOf) || !Number.isFinite(Date.parse(asOf))) throw new Error("Enter a valid ISO simulation timestamp before checking telemetry.");
      const result = await checkColdChainTelemetry(batchId.trim(), asOf); setMessage(`Clock check completed: ${result.alerts.length} missing-telemetry events updated.`); await refreshAfterSave();
    })}>Check missing telemetry</button>
    {message ? <p role="status" className="mt-2">{message}</p> : null}
  </details>;
}
