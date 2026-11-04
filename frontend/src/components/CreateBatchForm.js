import React, { useEffect, useRef, useState } from "react";
import { createManufacturerBatch } from "../services/workflow";

const emptyForm = () => ({ batchId: "", vaccineType: "", quantity: "", supplier: "",
  materialType: "", materialQuantity: "", unit: "units", expiresAt: "", remarks: "" });
const fields = [
  ["batchId", "Batch ID", "text", 120],
  ["vaccineType", "Vaccine type / product", "text", 200],
  ["quantity", "Batch quantity (doses)", "number"],
  ["supplier", "Supplier", "text", 200],
  ["materialType", "Material type", "text", 200],
  ["materialQuantity", "Material quantity (whole units)", "number"],
  ["unit", "Material unit", "text", 40],
  ["expiresAt", "Expiry date (UTC)", "date"],
];

function validate(form) {
  const errors = {};
  for (const [name, label, type, maxLength] of fields) {
    const text = form[name].trim();
    if (!text) errors[name] = `${label} is required.`;
    else if (maxLength && text.length > maxLength) errors[name] = `${label} must be at most ${maxLength} characters.`;
    else if (type === "number" && (!Number.isSafeInteger(Number(text)) || Number(text) <= 0))
      errors[name] = `${label} must be a positive whole number within the supported range.`;
  }
  if (form.expiresAt) {
    const expiry = new Date(`${form.expiresAt}T00:00:00.000Z`);
    if (!Number.isFinite(+expiry) || +expiry <= Date.now() || expiry.toISOString().slice(0, 10) !== form.expiresAt)
      errors.expiresAt = "Choose a future expiry date. Expiry is the beginning of that date in UTC.";
  }
  if (form.remarks.trim().length > 2000) errors.remarks = "Remarks must be at most 2000 characters.";
  return errors;
}

export default function CreateBatchForm({ manufacturer, onCreated, onClose }) {
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsInspection, setNeedsInspection] = useState(false);
  const [created, setCreated] = useState(null);
  const [refreshError, setRefreshError] = useState("");
  const inFlight = useRef(false);
  const firstInput = useRef(null);
  useEffect(() => { firstInput.current?.focus(); }, []);

  const change = (name, value) => {
    setForm(previous => ({ ...previous, [name]: value }));
    setErrors(previous => ({ ...previous, [name]: undefined }));
  };
  const refreshDashboard = async result => {
    setRefreshError("");
    try { await onCreated(result); }
    catch (_) { setRefreshError("The batch was created, but the dashboard could not refresh. Refresh it below or reload the page. Do not submit this batch again."); }
  };
  const submit = async event => {
    event.preventDefault();
    if (inFlight.current || created || needsInspection) return;
    const problems = validate(form);
    setErrors(problems); setError("");
    if (Object.keys(problems).length) {
      event.currentTarget.elements.namedItem(Object.keys(problems)[0])?.focus();
      return;
    }
    inFlight.current = true; setBusy(true);
    try {
      const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]));
      payload.quantity = Number(payload.quantity);
      payload.materialQuantity = Number(payload.materialQuantity);
      payload.expiresAt = `${payload.expiresAt}T00:00:00.000Z`;
      // Ownership is assigned by the authenticated server, never by editable form data.
      const result = await createManufacturerBatch(payload);
      if (!result?.batch?.batchId) throw new Error("The server did not confirm the created batch.");
      setCreated(result);
      await refreshDashboard(result);
    } catch (failure) {
      const status = failure.response?.status;
      const code = failure.response?.data?.code;
      const message = failure.response?.data?.error || failure.message || "Unable to create batch.";
      const uncertain = !failure.response || code === "MANUFACTURING_INCOMPLETE" || (status >= 500 && code !== "BLOCKCHAIN_NOT_READY");
      setNeedsInspection(uncertain);
      setError(status === 401 || status === 403
        ? "Sign in again as Manufacturer. Your session may have expired or another browser tab may be using a different role."
        : `${Array.isArray(message) ? message.join("; ") : message}${uncertain ? " Check saved records and the blockchain before any retry; creation may have partially completed." : ""}`);
    } finally { inFlight.current = false; setBusy(false); }
  };
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const inputClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:bg-slate-100";

  return <section id="create-batch" aria-labelledby="create-batch-title" className="mb-6 rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4">
      <div><h3 id="create-batch-title" className="text-xl font-semibold text-slate-800">Create New Batch</h3>
        <p className="mt-1 text-sm text-slate-600">Create raw-material, production, batch and report records using the existing manufacturing workflow.</p></div>
      <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{created ? "Close" : "Cancel"}</button>
    </div>
    <p className="my-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Software-only demo/test data. Creation does not release a batch or approve a medical storage policy. Production and Lab sign-offs remain separate.</p>
    {created ? <div>
      <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">Batch {created.batch.batchId} created successfully.</p>
        <p>{created.batch.vaccineType} · {created.batch.quantity} doses · {created.batch.manufacturer}</p>
        <p>Expiry: {new Date(created.batch.expiresAt).toISOString().slice(0, 10)} (UTC)</p>
        <p>Release: {created.batch.releaseStage || "Awaiting Production and Lab sign-offs"}. Find the batch in Recent Vaccine Batches below.</p>
        {created.txHash && <p className="mt-2 break-all">Registration transaction: {created.txHash}</p>}
      </div>
      {(created.warnings || []).map(warning => <p role="alert" key={warning} className="mt-2 text-sm text-amber-800">{warning}</p>)}
      {refreshError && <p role="alert" className="mt-2 text-sm text-amber-800">{refreshError}</p>}
      <button type="button" disabled={busy} className="mt-3 rounded-lg border px-3 py-2 text-sm" onClick={async () => {
        setBusy(true); await refreshDashboard(created); setBusy(false);
      }}>Refresh dashboard</button>
    </div> : <form aria-label="Create vaccine batch" onSubmit={submit} noValidate className="mt-4">
      {error && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <fieldset disabled={busy || needsInspection} className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <label htmlFor="new-batch-manufacturer" className="text-sm font-medium text-slate-700">Manufacturer (signed-in account)
          <input id="new-batch-manufacturer" className={`${inputClass} bg-slate-50`} readOnly value={manufacturer || "Assigned from your signed-in account"} />
        </label>
        {fields.map(([name, label, type, maxLength]) => <div key={name}>
          <label htmlFor={`new-batch-${name}`} className="text-sm font-medium text-slate-700">{label} *</label>
          <input id={`new-batch-${name}`} name={name} ref={name === "batchId" ? firstInput : undefined}
            type={type} required maxLength={maxLength} value={form[name]} className={inputClass}
            min={type === "number" ? 1 : type === "date" ? tomorrow : undefined}
            max={type === "number" ? Number.MAX_SAFE_INTEGER : undefined} step={type === "number" ? 1 : undefined}
            aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `new-batch-${name}-error` : undefined}
            onChange={event => change(name, event.target.value)} />
          {errors[name] && <p id={`new-batch-${name}-error`} role="alert" className="mt-1 text-xs text-red-700">{errors[name]}</p>}
        </div>)}
        <div className="md:col-span-2 lg:col-span-3">
          <label htmlFor="new-batch-remarks" className="text-sm font-medium text-slate-700">Remarks (optional)</label>
          <textarea id="new-batch-remarks" name="remarks" rows={3} maxLength={2000} className={inputClass} value={form.remarks}
            aria-invalid={Boolean(errors.remarks)} aria-describedby={errors.remarks ? "new-batch-remarks-error" : undefined}
            onChange={event => change("remarks", event.target.value)} />
          {errors.remarks && <p id="new-batch-remarks-error" role="alert" className="text-xs text-red-700">{errors.remarks}</p>}
        </div>
        <p className="text-xs text-slate-500 md:col-span-2 lg:col-span-3">Use a unique batch ID. Expiry is the beginning of the chosen date in UTC. A running local blockchain and deployed contract are required. Keep this page open until the request completes.</p>
        <button type="submit" className="rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-50">
          {busy ? "Creating batch…" : "Create batch and report"}
        </button>
      </fieldset>
    </form>}
  </section>;
}
