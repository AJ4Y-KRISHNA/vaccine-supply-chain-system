import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchManufacturerWorkflow } from "../services/workflow";
import BlockchainLog from "./BlockchainLog";

const when = value => value && Number.isFinite(+new Date(value)) ? new Date(value).toLocaleString() : "Not recorded";
export default function ManufacturerRecords({ mode, onClose, revision = 0, onSignRelease, loadingBatchId = "", actionsBlocked = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await fetchManufacturerWorkflow()); }
    catch (failure) { setError(failure.response?.data?.error || "Unable to load manufacturing records. Check your session and backend, then retry."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, revision]);
  const batches = useMemo(() => (data?.batches || []).filter(batch => `${batch.batchId} ${batch.vaccineType} ${batch.status}`.toLowerCase().includes(query.toLowerCase())), [data, query]);
  const certificates = (data?.certificates || []).filter(item => `${item.batchId} ${item.certificateId} ${item.vaccineType}`.toLowerCase().includes(query.toLowerCase()));
  const title = mode === "certificates" ? "Quality Certificates — Inventory Records" : "Batch History";
  return <section aria-label={title} className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-xl font-semibold">{title}</h3><p className="text-sm text-slate-600">All records accessible to your manufacturer account, not only the five recent batches.</p></div>
      <div className="flex gap-2"><button type="button" disabled={loading} onClick={load} className="rounded-lg border px-3 py-2">{loading ? "Loading…" : "Refresh records"}</button><button type="button" onClick={onClose} className="rounded-lg border px-3 py-2">Close records</button></div>
    </div>
    {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error} Existing results may be stale.</p>}
    <label className="mb-4 block text-sm font-medium">Search manufacturing records<input className="mt-1 block w-full rounded-lg border p-2" value={query} onChange={event => setQuery(event.target.value)} placeholder="Batch ID, vaccine product or certificate" /></label>
    {mode === "certificates" ? <>
      <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">These are the existing demand-baseline inventory certificates. They are not clinical quality certificates, vaccine safety determinations or substitutes for separate Production/Lab sign-offs.</p>
      <div className="overflow-x-auto"><table><thead><tr><th>Certificate / batch</th><th>Product</th><th>Baseline demand</th><th>Issued / release</th><th>Blockchain confirmation</th></tr></thead><tbody>
        {certificates.map(item => <tr key={item._id || item.certificateId}><td>{item.certificateId}<br />{item.batchId}</td><td>{item.vaccineType}</td><td>{item.predictedDemand ?? 0}</td><td>{when(item.issuedAt)}<br />{item.releaseVisibleToExternal ? "Released" : "Locked"}</td><td className="font-mono">{item.txHash || "No confirmed transaction"}</td></tr>)}
        {!loading && !certificates.length && <tr><td colSpan={5}>No matching inventory certificate records.</td></tr>}
      </tbody></table></div>
    </> : <>
      <div className="overflow-x-auto"><table><thead><tr><th>Batch ID</th><th>Product / doses</th><th>Expiry</th><th>Status</th><th>Records</th></tr></thead><tbody>
        {batches.map(batch => <tr key={batch.batchId}><td>{batch.batchId}</td><td>{batch.vaccineType}<br />{Number(batch.quantity || 0).toLocaleString()} doses</td><td>{when(batch.expiresAt)}</td><td>{batch.coldChainStatus || batch.releaseStage || batch.status}</td><td><button type="button" className="rounded-lg border px-3 py-2 text-blue-700" aria-expanded={selected === batch.batchId} onClick={() => setSelected(previous => previous === batch.batchId ? "" : batch.batchId)}>View {batch.batchId}</button></td></tr>)}
        {!loading && !batches.length && <tr><td colSpan={5}>No matching batches.</td></tr>}
      </tbody></table></div>
      {selected && <div className="mt-5 rounded-lg border bg-slate-50 p-4"><h4 className="mb-3 font-semibold">Manufacturing records: {selected}</h4>
        {onSignRelease && (() => {
          const batch = data?.batches?.find(item => item.batchId === selected);
          if (!batch) return null;
          const blocked = actionsBlocked || Boolean(error) || loading || Boolean(loadingBatchId) || batch.coldChainHoldAlertIds?.length > 0 || String(batch.coldChainStatus).toLowerCase().includes("quarantin") || (batch.expiresAt && +new Date(batch.expiresAt) <= Date.now());
          return <div className="mb-4 flex flex-wrap gap-3">
            <button type="button" disabled={blocked || batch.productionApproved} className="rounded-lg bg-blue-700 px-3 py-2 text-sm text-white" onClick={() => onSignRelease(selected, "Production")}>{batch.productionApproved ? "Production Signed" : "Production Sign"}</button>
            <button type="button" disabled={blocked || batch.labApproved} className="rounded-lg bg-violet-700 px-3 py-2 text-sm text-white" onClick={() => onSignRelease(selected, "Lab Testing")}>{batch.labApproved ? "Lab Signed" : "Lab Sign"}</button>
          </div>;
        })()}
        {[ ["Raw materials", "rawMaterials", "materialType", "receivedAt"], ["Production", "productions", "vaccineType", "producedAt"], ["Batch reports", "reports", "remarks", "createdAt"] ].map(([label, key, description, date]) => <div key={key} className="mb-4"><h5 className="text-sm font-semibold">{label}</h5>
          {(data?.[key] || []).filter(item => item.batchId === selected).map(item => <div key={item._id} className="mt-2 rounded border bg-white p-3 text-sm"><p>{item[description] || "Not recorded"} · Quantity: {item.quantity} {item.unit || "doses"} · {item.status}</p><p>{when(item[date])}</p>{item.txHash && <p className="break-all font-mono text-xs">{item.txHash}</p>}</div>)}
          {!(data?.[key] || []).some(item => item.batchId === selected) && <p className="text-sm text-slate-500">No saved records.</p>}
        </div>)}
        <BlockchainLog key={selected} title={`Blockchain audit: ${selected}`} batchIds={[selected]} initialBatchId={selected} />
      </div>}
    </>}
    {loading && <p role="status" className="mt-3 text-sm text-slate-600">Loading manufacturing records…</p>}
  </section>;
}
