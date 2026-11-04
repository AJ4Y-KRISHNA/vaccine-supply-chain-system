import React, { useCallback, useEffect, useState } from "react";
import { History, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { fetchColdChainReviewers, setColdChainReviewer } from "../services/traceability";

function dateText(value) { const date = new Date(value); return Number.isFinite(+date) ? date.toLocaleString() : "—"; }
export default function ReviewerPermissionsPanel() {
  const [reviewers, setReviewers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => { setError(""); try { const data = await fetchColdChainReviewers(); setReviewers(data.reviewers || []); setAudit(data.audit || []); }
    catch (failure) { setError(failure.response?.data?.error || "Reviewer permissions could not be loaded."); } }, []);
  useEffect(() => { load(); }, [load]);
  const update = async reviewer => {
    if (busy) return;
    const reason = String(reasons[reviewer.userId] || "").trim();
    if (reason.length < 3) { setError("Enter a reason of at least 3 characters for each permission change."); return; }
    setBusy(reviewer.userId); setError(""); setNotice("");
    try { await setColdChainReviewer(reviewer.userId, { canReviewColdChain: !reviewer.canReviewColdChain, reason });
      setReasons(current => ({ ...current, [reviewer.userId]: "" })); setNotice(`Reviewer permission updated for ${reviewer.email}.`); await load(); }
    catch (failure) { setError(failure.response?.data?.error || "Permission change could not be completed. Refresh the list before retrying."); }
    finally { setBusy(""); }
  };
  return <section id="admin-reviewers" aria-label="Cold-chain reviewer permissions" className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950"><ShieldCheck size={19} /> Audited reviewer permissions</h2><p className="mt-1 text-sm text-slate-600">Only designated admin/manufacturer accounts can approve cold-chain policies and record quality review or clearance. Each change requires a reason and is recorded append-only.</p></div><button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm text-emerald-900"><RefreshCw size={15} /> Refresh</button></div>
    {error && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}{notice && <p role="status" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    <div className="overflow-x-auto"><table className="min-w-[760px] w-full text-left text-sm"><thead><tr><th className="p-3">Account</th><th className="p-3">Role / organization</th><th className="p-3">Permission</th><th className="p-3">Reason for change</th><th className="p-3">Action</th></tr></thead><tbody>{reviewers.map(reviewer => <tr key={reviewer.userId} className="border-t border-slate-100 align-top"><td className="p-3"><span className="font-medium">{reviewer.email}</span>{reviewer.disabled && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Disabled</span>}</td><td className="p-3">{reviewer.role}{reviewer.organization ? <span className="block text-xs text-slate-500">{reviewer.organization}</span> : null}</td><td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${reviewer.canReviewColdChain ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>{reviewer.canReviewColdChain ? "Designated reviewer" : "No review access"}</span></td><td className="p-3"><input aria-label={`Reason for ${reviewer.email}`} minLength={3} maxLength={1000} value={reasons[reviewer.userId] || ""} onChange={event => setReasons(current => ({ ...current, [reviewer.userId]: event.target.value }))} placeholder="Why is this change needed?" className="w-full rounded-lg border border-slate-300 px-3 py-2" /></td><td className="p-3"><button type="button" disabled={Boolean(busy) || (reviewer.disabled && !reviewer.canReviewColdChain)} onClick={() => update(reviewer)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{reviewer.canReviewColdChain ? <><ShieldOff size={14} /> Revoke</> : <><ShieldCheck size={14} /> Designate</>}{busy === reviewer.userId ? "…" : ""}</button></td></tr>)}</tbody></table></div>
    {!reviewers.length && <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-slate-600">No active admin or manufacturer accounts are available for reviewer designation.</p>}
    <div className="mt-5 border-t border-slate-100 pt-4"><h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-800"><History size={16} /> Recent permission audit</h3>{audit.length ? <ol className="max-h-72 space-y-2 overflow-auto">{audit.map(entry => <li key={entry._id} className="rounded-lg bg-slate-50 p-3 text-xs"><p className="font-semibold text-slate-800">{entry.action.replaceAll("_", " ")} · {entry.targetEmail}</p><p className="mt-1 text-slate-600">{entry.reason}</p><p className="mt-1 text-slate-500">By {entry.actorId} · {dateText(entry.eventTime)}</p></li>)}</ol> : <p className="text-sm text-slate-500">No reviewer permission changes recorded.</p>}</div>
  </section>;
}
