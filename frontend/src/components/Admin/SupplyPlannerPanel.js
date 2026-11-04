import React, { useEffect, useRef, useState } from "react";
import API from "../../services/api";

const inputClass = "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100";
const isDoseCount = value => String(value).trim() !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0;

export default function SupplyPlannerPanel() {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState({});
  const [capacity, setCapacity] = useState("");
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const submitting = useRef(false);
  const loadingInputs = useRef(false);

  const load = async () => {
    if (loadingInputs.current || submitting.current) return;
    loadingInputs.current = true;
    setLoading(true);
    setLoadError("");
    setResult(null);
    try {
      const response = await API.get("/admin/supply-plan/inputs");
      const current = response.data?.orders || [];
      setOrders(current);
      setSelected(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => current.some(order => order.orderId === id))));
    } catch (_error) {
      setLoadError("Planning inputs unavailable. Refresh successfully before generating a plan; previous order data may be stale.");
    } finally {
      loadingInputs.current = false;
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const change = (id, field, value) => {
    setSelected(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setResult(null);
  };

  const submit = async event => {
    event.preventDefault();
    if (submitting.current || loading || loadError) return;
    setError("");
    setResult(null);
    const choices = orders.filter(order => selected[order.orderId]?.enabled);
    if (!choices.length || choices.length > 100) { setError("Select between 1 and 100 pending orders."); return; }
    if (!isDoseCount(capacity)) { setError("Transport capacity must be an explicit nonnegative whole number of doses."); return; }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(asOf.trim()) || !Number.isFinite(+new Date(asOf))) { setError("Enter a valid planning timestamp, including the time zone (for example, 2030-01-01T00:00:00.000Z)."); return; }
    const sharedCapacity = new Map();
    for (const order of choices) {
      const value = selected[order.orderId];
      if (!isDoseCount(value.capacity ?? "") || String(value.hours ?? "").trim() === "" || !Number.isFinite(Number(value.hours)) || Number(value.hours) < 0 || Number(value.hours) > 8760) {
        setError(`For ${order.orderId}, enter whole-number hospital free capacity and transit hours from 0 to 8760.`); return;
      }
      const hospital = String(order.hospital).trim().toLowerCase();
      if (sharedCapacity.has(hospital) && sharedCapacity.get(hospital) !== Number(value.capacity)) {
        setError("Use the same shared free capacity for all selected orders going to one hospital."); return;
      }
      sharedCapacity.set(hospital, Number(value.capacity));
    }
    submitting.current = true;
    setBusy(true);
    try {
      const destinations = choices.map(order => ({ orderId: order.orderId, freeCapacityDoses: Number(selected[order.orderId].capacity), transitHours: Number(selected[order.orderId].hours) }));
      const response = await API.post("/admin/supply-plan", { destinations, transportCapacityDoses: Number(capacity), asOf: new Date(asOf).toISOString() });
      setResult(response.data);
    } catch (requestError) { setError(requestError.response?.data?.error || "Plan could not be generated. Check the backend connection and try again."); }
    finally { submitting.current = false; setBusy(false); }
  };

  return <section id="admin-supply-plan" aria-labelledby="supply-planning-title" className="my-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <h3 id="supply-planning-title" className="text-lg font-semibold text-slate-900">Constrained supply planning</h3>
      <button type="button" onClick={load} disabled={loading || busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">{loading ? "Loading orders…" : "Refresh pending orders"}</button>
    </div>
    <p className="mb-4 text-sm text-slate-600">The optimizer computes a globally constrained allocation across eligible stock, expiry at arrival, order priority, shared hospital capacity, total vehicle capacity and transit time. Unknown expiry and held or unreleased batches are excluded. The plan does not reserve inventory or dispatch a shipment until an authorized user approves the order workflow.</p>
    {(error || loadError) && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{loadError || error}</p>}
    <form onSubmit={submit} noValidate>
      <fieldset disabled={busy || loading || Boolean(loadError)} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">Planning timestamp (ISO with time zone)<input required aria-label="Planning timestamp" className={inputClass} value={asOf} onChange={event => { setAsOf(event.target.value); setResult(null); }} /></label>
          <label className="text-sm font-medium">Transport capacity (doses)<input required type="number" min="0" step="1" className={inputClass} value={capacity} onChange={event => { setCapacity(event.target.value); setResult(null); }} /></label>
        </div>
        {!loading && !orders.length && !loadError && <p role="status" className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No pending hospital orders. Create a hospital order before planning supply.</p>}
        {orders.map(order => <div key={order.orderId} className="rounded-xl border border-slate-200 p-4">
          <label className="flex items-start gap-3 text-sm font-medium"><input type="checkbox" className="mt-1" checked={!!selected[order.orderId]?.enabled} onChange={event => change(order.orderId, "enabled", event.target.checked)} /><span>{order.orderId} — {order.hospital}: {order.requestedDoses} {order.vaccineType}</span></label>
          {selected[order.orderId]?.enabled && <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm">Hospital free capacity — {order.orderId}<input required type="number" min="0" step="1" className={inputClass} value={selected[order.orderId]?.capacity ?? ""} onChange={event => change(order.orderId, "capacity", event.target.value)} /></label>
            <label className="text-sm">Transit hours — {order.orderId}<input required type="number" min="0" max="8760" step="any" className={inputClass} value={selected[order.orderId]?.hours ?? ""} onChange={event => change(order.orderId, "hours", event.target.value)} /></label>
          </div>}
        </div>)}
        <button type="submit" disabled={busy || loading || Boolean(loadError) || !orders.length} className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Solving allocation…" : "Generate allocation plan"}</button>
      </fieldset>
    </form>
    {result && <div role="status" className="mt-5 space-y-4">
      <p className="break-words rounded-lg bg-blue-50 p-4 text-sm text-blue-900">Plan {result.planId}: {result.totalAllocated} doses proposed. {result.execution}</p>
      <p className="text-sm text-slate-600">{result.explanation}</p>
      {result.optimizationObjective && <p className="text-sm text-slate-600">Optimization order: {result.optimizationObjective}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><caption className="mb-2 text-left font-semibold">Proposed allocations (not dispatched)</caption><thead className="border-b border-slate-200 bg-slate-50"><tr>{["Order", "Batch", "Doses", "Transit (hours)", "Arrival", "Expiry"].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>
        {(result.allocations || []).map((allocation, index) => <tr key={`${allocation.orderId}-${allocation.batchId}-${index}`} className="border-b border-slate-100"><td className="px-3 py-3">{allocation.orderId}</td><td className="px-3 py-3">{allocation.batchId}</td><td className="px-3 py-3">{allocation.quantity}</td><td className="px-3 py-3">{allocation.transitHours ?? "—"}</td><td className="px-3 py-3">{allocation.arrivalAt}</td><td className="px-3 py-3">{allocation.expiresAt}</td></tr>)}
        {!result.allocations?.length && <tr><td colSpan={6} className="p-4 text-slate-600">No eligible allocations. Review unfilled demand and exclusions below.</td></tr>}
      </tbody></table></div>
      {(result.unfilled || []).map(item => <p key={item.orderId} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{item.orderId}: {item.doses} unfilled — {item.reason}</p>)}
      <details className="rounded-lg border border-slate-200 p-3 text-sm"><summary className="cursor-pointer font-semibold">Excluded batches ({result.excludedBatches?.length || 0})</summary>{(result.excludedBatches || []).map(batch => <p key={batch.batchId} className="mt-2">{batch.batchId}: {(batch.reasons || []).join(", ")}</p>)}{!result.excludedBatches?.length && <p className="mt-2">No batches excluded.</p>}</details>
    </div>}
  </section>;
}
