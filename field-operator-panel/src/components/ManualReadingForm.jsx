import React, { useState } from "react";
import { Send } from "lucide-react";
import { submitManualReading } from "../services/fieldOperatorApi.js";

export default function ManualReadingForm({ token, shipment, telemetry }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [form, setForm] = useState({ temperature: "", humidity: "", battery: "", lat: telemetry?.gpsLat ?? "", lon: telemetry?.gpsLng ?? "", timestamp: new Date().toISOString().slice(0, 16), note: "" });
  if (!token || !shipment) return null;
  const change = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await submitManualReading(token, { batchId: shipment.batchId, shipmentId: shipment.shipmentId,
        vehicleId: shipment.vehicleId || telemetry?.vehicleId || "FIELD-TRUCK", temperature: Number(form.temperature), humidity: Number(form.humidity),
        battery: Number(form.battery), lat: Number(form.lat), lon: Number(form.lon), timestamp: new Date(form.timestamp).toISOString(), note: form.note });
      setMessage(`Manual reading queued${result.needsReview ? " and flagged for review" : ""}.`);
    } catch (failure) { setError(failure.message || "Unable to submit manual reading"); }
    finally { setBusy(false); }
  };
  const field = (label, name, min, max, step = "any") => <label className="grid gap-1 text-xs text-text-secondary">{label}<input name={name} type="number" min={min} max={max} step={step} required value={form[name]} onChange={change} className="min-h-10 rounded-input border border-border bg-background px-3 py-2 text-sm text-text-primary" /></label>;
  return <section aria-label="Manual telemetry entry" className="operator-panel-surface mb-5 p-4 sm:p-5">
    <h2 className="text-sm font-semibold text-text-primary">Record manual sensor reading</h2>
    <p className="mt-1 text-xs text-text-muted">Synthetic entry for {shipment.batchId}; policy alerts and anchoring use the shared backend pipeline.</p>
    {error && <p role="alert" className="mt-3 rounded-input bg-danger/10 p-2 text-xs text-danger">{error}</p>}{message && <p role="status" className="mt-3 rounded-input bg-emerald-950/40 p-2 text-xs text-emerald-300">{message}</p>}
    <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {field("Temperature °C", "temperature", -40, 60, "0.1")}{field("Humidity %", "humidity", 0, 100, "0.1")}{field("Battery %", "battery", 0, 100, "0.1")}{field("Latitude", "lat", -90, 90)}{field("Longitude", "lon", -180, 180)}
      <label className="grid gap-1 text-xs text-text-secondary">Timestamp<input type="datetime-local" name="timestamp" required value={form.timestamp} onChange={change} className="min-h-10 rounded-input border border-border bg-background px-3 py-2 text-sm text-text-primary" /></label>
      <label className="grid gap-1 text-xs text-text-secondary sm:col-span-2">Operator note (required)<input name="note" maxLength={1000} required value={form.note} onChange={change} className="min-h-10 rounded-input border border-border bg-background px-3 py-2 text-sm text-text-primary" /></label>
      <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-input bg-primary px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"><Send size={15} />{busy ? "Sending…" : "Submit manual reading"}</button>
    </form>
  </section>;
}
