import React, { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, CircleAlert, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { fetchSystemReadiness } from "../services/traceability";

const statusText = value => ({ healthy: "Healthy", ready: "Ready", unhealthy: "Unhealthy", unreachable: "Not reachable", unavailable: "Unavailable", connecting: "Connecting", unconfigured: "Not configured",
  "wrong-chain": "Wrong chain", "blocked-non-local-endpoint": "Blocked: not local", "invalid-local-configuration": "Invalid local setup",
  "not-configured": "Not configured", "not-checked": "Not checked", "abi-artifact-missing": "ABI artifact missing", "no-contract-at-configured-address": "No contract deployed",
  "not-progressing": "Block did not advance", timeout: "Timed out", "invalid-response": "Unexpected response" }[value] || "Status unknown");
function tone(healthy) { return healthy ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"; }
function ServiceCard({ title, service, reachable, healthy, status, latencyMs, children }) {
  const Icon = healthy ? CheckCircle2 : CircleAlert;
  return <article aria-label={`${title} health status`} className={`rounded-xl border p-4 ${tone(healthy)}`}>
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{title}</h3><span className="inline-flex items-center gap-1.5 text-sm font-medium"><Icon size={16} />{statusText(status)}</span></div>
    <p className="mt-1 text-xs opacity-75">{service}</p>
    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-current/10 pt-2 text-xs">
      <dt>Reachable</dt><dd className="text-right font-medium">{reachable ? "Yes" : "No"}</dd>
      <dt>Functional check</dt><dd className="text-right font-medium">{healthy ? "Passed" : "Failed"}</dd>
      <dt>Latency</dt><dd className="text-right font-medium">{Number.isFinite(latencyMs) ? `${latencyMs} ms` : "—"}</dd>
    </dl>
    {children}
  </article>;
}

export default function SystemReadinessPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setData(await fetchSystemReadiness()); }
    catch (failure) { setError(failure.response?.data?.error || "Readiness status could not be retrieved. The backend endpoint may be unavailable."); }
    finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  return <section id="admin-readiness" aria-label="Local system readiness" className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950"><Server size={19} /> Local-system readiness</h2><p className="mt-1 text-sm text-slate-600">Pre-demo checks for this software prototype. Only availability status is shown; signing keys, addresses and other secrets are never returned.</p></div>
      <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm text-emerald-900 disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />{loading ? "Checking…" : "Check again"}</button></div>
    {error && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {data && <><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <ServiceCard title="Backend API" service={data.backend?.service} reachable={data.backend?.reachable} healthy={data.backend?.healthy} status={data.backend?.status} latencyMs={data.backend?.latencyMs} />
      <ServiceCard title="Database" service={data.database?.service} reachable={data.database?.reachable} healthy={data.database?.healthy} status={data.database?.status} latencyMs={data.database?.latencyMs}><p className="mt-2 text-xs">Probe: temporary write, read-back, and cleanup</p></ServiceCard>
      <ServiceCard title="Local blockchain" service={data.blockchain?.service} reachable={data.blockchain?.reachable} healthy={data.blockchain?.healthy} status={data.blockchain?.status} latencyMs={data.blockchain?.latencyMs}>
        <div className="mt-3 border-t border-current/10 pt-2 text-xs"><p>Block progression: {data.blockchain?.blockProgressed ? "Confirmed" : "Not confirmed"}</p>{data.blockchain?.blockNumber != null && <p>Current block: {data.blockchain.blockNumber}</p>}<p>Contract configured: {data.blockchain?.contract?.addressConfigured ? "Yes" : "No"}</p><p>ABI available: {data.blockchain?.contract?.artifactAvailable ? "Yes" : "No"}</p><p>Contract status: {statusText(data.blockchain?.contract?.status)}</p></div>
      </ServiceCard>
      <ServiceCard title="AI decision service" service={data.ai?.service} reachable={data.ai?.reachable} healthy={data.ai?.healthy} status={data.ai?.status} latencyMs={data.ai?.latencyMs}><p className="mt-2 text-xs">Probe: synthetic advisory decision request</p></ServiceCard>
    </div><p className="mt-3 text-xs text-slate-500"><Activity size={13} className="mr-1 inline" />Last checked {data.checkedAt ? new Date(data.checkedAt).toLocaleString() : "just now"}. “Reachable” means the service responded; “Healthy” means its functional check passed.</p><div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><ShieldCheck size={15} className="mt-0.5 shrink-0" />The blockchain check mines one empty block on the local Hardhat node to verify block progression; it does not send a contract transaction. Never paste private keys or environment-file values into a presentation or screenshot.</div></>}
  </section>;
}
