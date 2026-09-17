import React, { useEffect, useState } from "react";
import API from "../../services/api";
export default function SupplyPlannerPanel() {
  const [orders, setOrders] = useState([]), [selected, setSelected] = useState({});
  const [capacity, setCapacity] = useState(""), [asOf, setAsOf] = useState(new Date().toISOString());
  const [result, setResult] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = () => API.get("/admin/supply-plan/inputs").then(r => setOrders(r.data.orders)).catch(() => setError("Planning inputs unavailable"));
  useEffect(() => { load(); }, []);
  const change = (id, field, value) => setSelected(s => ({ ...s, [id]: { ...s[id], [field]: value } }));
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError(""); setResult(null);
    try {
      const destinations = orders.filter(o => selected[o.orderId]?.enabled).map(o => ({ orderId: o.orderId,
        freeCapacityDoses: Number(selected[o.orderId].capacity), transitHours: Number(selected[o.orderId].hours) }));
      const response = await API.post("/admin/supply-plan", { destinations, transportCapacityDoses: Number(capacity), asOf });
      setResult(response.data);
    } catch (error) { setError(error.response?.data?.error || "Plan could not be generated"); }
    finally { setBusy(false); }
  };
  return <section className="card p-3 my-3"><h3>Constrained supply planning</h3>
    <p>Advisory only. Uses pending order demand and first-expiry-first-out stock. Unknown expiry is excluded. Enter demo free capacity and transit estimates explicitly; no inventory is reserved.</p>
    <button type="button" onClick={load}>Refresh pending orders</button>
    {error && <p role="alert">{error}</p>}
    <form onSubmit={submit}>
      <label>Planning timestamp <input required aria-label="Planning timestamp" value={asOf} onChange={e => setAsOf(e.target.value)} /></label>{" "}
      <label>Transport capacity (doses) <input required type="number" min="0" step="1" value={capacity} onChange={e => setCapacity(e.target.value)} /></label>
      {orders.map(order => <div key={order.orderId} className="border p-2 my-2">
        <label><input type="checkbox" checked={!!selected[order.orderId]?.enabled} onChange={e => change(order.orderId, "enabled", e.target.checked)} /> {order.orderId} — {order.hospital}: {order.requestedDoses} {order.vaccineType}</label>
        {selected[order.orderId]?.enabled && <div>
          <label>Hospital free capacity <input required type="number" min="0" step="1" value={selected[order.orderId]?.capacity ?? ""} onChange={e => change(order.orderId, "capacity", e.target.value)} /></label>{" "}
          <label>Transit hours <input required type="number" min="0" max="8760" step="any" value={selected[order.orderId]?.hours ?? ""} onChange={e => change(order.orderId, "hours", e.target.value)} /></label>
        </div>}
      </div>)}
      <button disabled={busy || !orders.length}>Generate advisory plan</button>
    </form>
    {result && <div><p>Plan {result.planId}: {result.totalAllocated} doses proposed. {result.execution}</p>
      <table className="table"><thead><tr><th>Order</th><th>Batch</th><th>Doses</th><th>Arrival</th><th>Expiry</th></tr></thead>
        <tbody>{result.allocations.map((a, i) => <tr key={i}><td>{a.orderId}</td><td>{a.batchId}</td><td>{a.quantity}</td><td>{a.arrivalAt}</td><td>{a.expiresAt}</td></tr>)}</tbody></table>
      {result.unfilled.map(u => <p key={u.orderId}>{u.orderId}: {u.doses} unfilled — {u.reason}</p>)}
      <details><summary>Excluded batches</summary>{result.excludedBatches.map(b => <p key={b.batchId}>{b.batchId}: {b.reasons.join(", ")}</p>)}</details>
    </div>}
  </section>;
}
