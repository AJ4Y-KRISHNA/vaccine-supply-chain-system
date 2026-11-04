import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Factory, RefreshCw, Shield, Stethoscope, Truck, Users } from "lucide-react";
import { fetchAdminMonitoring, fetchAdminWorkflow, fetchDistributorWorkflow, fetchManufacturerWorkflow, fetchVaccinationWorkflow } from "../services/workflow";

const MODULES = [
  { key: "manufacturer", title: "Manufacturer Module", icon: Factory, load: fetchManufacturerWorkflow, fields: [["Receive Raw Materials", "rawMaterials"], ["Produce Vaccine", "productions"], ["Create Vaccine Batch", "batches"], ["Create Batch Report", "reports"]] },
  { key: "distributor", title: "Distributor Module", icon: Truck, load: fetchDistributorWorkflow, fields: [["Receive Vaccine Batch", "shipments"], ["Verify Vaccine Details", "verificationQueue"], ["Monitoring Updates", "temperatureLogs"], ["Vaccine Supply", "suppliedShipments"]] },
  { key: "healthcare", title: "Vaccination Center Module", icon: Stethoscope, load: fetchVaccinationWorkflow, fields: [["Vaccine Request", "requests"], ["Stock Management", "inventory"], ["Administer Vaccines", "administrations"], ["Record & Report", "reports"]] },
  { key: "admin", title: "Admin Module", icon: Users, load: async () => {
    const [workflow, monitoring] = await Promise.all([fetchAdminWorkflow(), fetchAdminMonitoring()]);
    return { ...workflow, summary: monitoring.summary };
  } },
];

function ArchitectureStatus() {
  const [modules, setModules] = useState({});
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  const storedRole = String(sessionStorage.getItem("role") || "").toLowerCase();
  const role = storedRole === "healthcare professional" ? "healthcare" : storedRole;
  const dashboardPath = { admin: "/admin", manufacturer: "/manufacturer", distributor: "/distributor", healthcare: "/hospital" }[role] || "/";
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    const visibleModules = MODULES.filter((module) => role === "admin" || module.key === role);
    const results = await Promise.allSettled(visibleModules.map((module) => module.load()));
    const next = {};
    visibleModules.forEach((module, index) => {
      const result = results[index];
      next[module.key] = result.status === "fulfilled" ? { data: result.value || {} } : {
        error: result.reason?.response?.status === 403 ? "Your current session cannot access this workflow. Sign in with the correct role." : "Workflow unavailable. Check the backend connection and retry.",
      };
    });
    setModules(next);
    setLoading(false);
    inFlight.current = false;
  }, [role]);

  useEffect(() => { load(); }, [load]);

  return <main className="dashboard-page min-h-screen bg-slate-50 px-4 py-6 text-slate-700 sm:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><Shield size={32} className="shrink-0 text-blue-700" /><div>
          <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">Architecture Status</h1>
          <p className="mt-1 text-sm text-slate-600">Recorded workflow activity visible to your signed-in role.</p>
        </div></div>
        <div className="flex flex-wrap gap-3">
          <Link to={dashboardPath} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Back to dashboard</Link>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><RefreshCw size={16} className={loading ? "animate-spin" : ""} />{loading ? "Refreshing…" : "Refresh status"}</button>
        </div>
      </header>
      <p className="mb-6 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><Activity size={18} className="shrink-0" />Counts represent stored activity, not proof that all batches are released, all workflows are complete, or services are healthy. Other roles’ records remain access-controlled.</p>
      {loading && <p role="status" className="mb-4 text-sm">Loading architecture status…</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {MODULES.map(({ key, title, icon: Icon, fields }) => {
          const entry = modules[key];
          const accessible = role === "admin" || role === key;
          const data = entry?.data;
          const steps = data && (fields ? fields.map(([label, field], index) => {
            const count = Array.isArray(data[field]) ? data[field].length : 0;
            return { title: `${index + 1}. ${label}`, status: count ? "Recorded" : "Pending", detail: `${count} record${count === 1 ? "" : "s"} available` };
          }) : (data.workflow || []).map((step) => ({ title: step.step, status: step.status, detail: `${data.summary?.blockchainLogs || 0} recorded transaction references; ${data.summary?.tempAlerts || 0} historical alert readings` })));
          return <section key={key} aria-label={title} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold text-slate-900"><Icon size={24} className="shrink-0 text-blue-700" />{title}</h2>
            {!accessible ? <p className="rounded-lg bg-slate-100 p-3 text-sm">Restricted to this module’s role or an administrator.</p> : entry?.error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{entry.error}</p> : steps ? <div className="space-y-3">
              {steps.map((step) => <div key={step.title} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{step.title}</h3><span className={`rounded-full px-3 py-1 text-xs font-semibold ${step.status === "Pending" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`}>{step.status}</span></div>
                <p className="mt-2 text-sm text-slate-600">{step.detail}</p>
              </div>)}
              {!steps.length && <p className="text-sm">No workflow activity returned yet.</p>}
            </div> : <p className="text-sm text-slate-500">Waiting for workflow data…</p>}
          </section>;
        })}
      </div>
    </div>
  </main>;
}

export default ArchitectureStatus;
