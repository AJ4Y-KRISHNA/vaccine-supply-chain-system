import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, MapPin, RefreshCw, Thermometer } from "lucide-react";
import { useToast } from "./Toast";
import ColdChainPolicyForm from "./ColdChainPolicyForm";
import {
  acknowledgeTemperatureAlert,
  fetchTemperatureAlertSummary,
  fetchTemperatureAlerts,
  fetchTemperatureNotifications,
  markTemperatureNotificationRead,
  actOnColdChainAlert,
  fetchColdChainAlert,
} from "../services/alerts";

const EMPTY_SUMMARY = { active: 0, critical: 0, warning: 0, resolved: 0, recent: [] };
const EMPTY_FILTERS = { status: "", severity: "", batchId: "", from: "", to: "" };

function dateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString();
}

function temperature(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}°C` : "--";
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${tone}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

export default function TemperatureAlertPanel({ role }) {
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [alerts, setAlerts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [auditTrail, setAuditTrail] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [filterError, setFilterError] = useState("");
  const [readingNotification, setReadingNotification] = useState("");
  const loadSequence = useRef(0);
  const detailSequence = useRef(0);
  const actionInFlight = useRef(false);
  const notificationInFlight = useRef(new Set());
  const canManage = ["admin", "manufacturer"].includes(role) && summary.permissions?.canManage;
  const canReview = canManage && summary.permissions?.canReview;
  const { addToast } = useToast();

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      setLoading(true);
      setError("");
      const [nextSummary, list, notificationData] = await Promise.all([
        fetchTemperatureAlertSummary(),
        fetchTemperatureAlerts({ ...appliedFilters, limit: 100 }),
        fetchTemperatureNotifications(),
      ]);
      if (sequence !== loadSequence.current) return;
      setSummary(nextSummary || EMPTY_SUMMARY);
      setAlerts(list?.alerts || []);
      setNotifications(notificationData?.notifications || []);
    } catch (requestError) {
      if (sequence !== loadSequence.current) return;
      const message = requestError?.response?.status === 403
        ? "Your account is not authorized to view temperature alerts."
        : requestError?.response?.data?.error || "Temperature alerts could not be loaded. Check that the backend is available.";
      setError(message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (!pendingAction && !actionId && document.visibilityState !== "hidden") load(); }, 5000);
    return () => clearInterval(timer);
  }, [load, pendingAction, actionId]);

  const applyFilters = () => {
    if (filters.from && filters.to && filters.from > filters.to) { setFilterError("From date must be on or before To date."); return; }
    setFilterError(""); setAppliedFilters({ ...filters, batchId: filters.batchId.trim() });
  };
  const clearFilters = () => {
    setFilterError("");
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  };

  const runAction = async (alert, action) => {
    if (actionInFlight.current) return;
    if (!pendingAction || pendingAction.reason.trim().length < 3) { addToast("error", "Enter an action note with at least 3 characters."); return; }
    if (["review", "clear"].includes(action) && (!/^\d{4}-\d{2}-\d{2}T/.test(pendingAction.asOf) || !Number.isFinite(Date.parse(pendingAction.asOf)))) { addToast("error", "A valid ISO evidence simulation clock is required."); return; }
    actionInFlight.current = true;
    try {
      setActionId(alert.alertId);
      if (action === "acknowledge") {
        await acknowledgeTemperatureAlert(alert.alertId, { reason: pendingAction.reason.trim() });
        addToast("success", "Temperature alert acknowledged");
        setPendingAction(null);
      } else {
        const detail = { reason: pendingAction.reason.trim(),
          ...(action === "action-taken" ? { action: pendingAction.actionTaken } : {}),
          ...(["review", "clear"].includes(action) ? { asOf: pendingAction.asOf } : {}) };
        await actOnColdChainAlert(alert.alertId, action, detail);
        addToast("success", `Cold-chain ${action} recorded`);
        setPendingAction(null);
      }
      // Any open history must be fetched again after an audit mutation.
      setSelectedAlert(null); setAuditTrail([]); ++detailSequence.current;
      await load();
    } catch (requestError) {
      addToast("error", requestError?.response?.data?.error || "Unable to update the temperature alert");
    } finally {
      actionInFlight.current = false;
      setActionId("");
    }
  };

  const selectAlert = async alert => {
    const sequence = ++detailSequence.current;
    const closing = selectedAlert?.alertId === alert.alertId;
    setSelectedAlert(closing ? null : alert);
    setAuditTrail([]);
    if (closing) { setAuditLoading(false); return; }
    setAuditLoading(true);
    try { const details = await fetchColdChainAlert(alert.alertId); if (sequence === detailSequence.current) setAuditTrail(details.auditTrail || []); }
    catch (_) { if (sequence === detailSequence.current) addToast("error", "Audit history could not be loaded"); }
    finally { if (sequence === detailSequence.current) setAuditLoading(false); }
  };
  const prepareAction = async (alert, action) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true; setActionId(alert.alertId);
    try {
      const details = await fetchColdChainAlert(alert.alertId);
      setPendingAction({ alert, action, reason: "", actionTaken: "inspect", asOf: details.evidenceAsOf || "" });
    } catch (_) { addToast("error", "Current evidence could not be loaded"); }
    finally { actionInFlight.current = false; setActionId(""); }
  };

  const markRead = async (notification) => {
    if (notification.read || notificationInFlight.current.has(notification._id)) return;
    notificationInFlight.current.add(notification._id); setReadingNotification(notification._id);
    try {
      await markTemperatureNotificationRead(notification._id);
      setNotifications((current) => current.map((item) => (item._id === notification._id ? { ...item, read: true } : item)));
    } catch (requestError) {
      addToast("error", requestError?.response?.data?.error || "Unable to mark notification as read");
    } finally { notificationInFlight.current.delete(notification._id); setReadingNotification(""); }
  };

  return (
    <section className="mt-5 rounded-[14px] border border-[#e4edf8] bg-white p-5 shadow-sm" aria-label="Temperature alert monitoring">
      <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <h3 className="flex items-center gap-2 text-[1.05rem] font-semibold text-[#42566f]">
            <Thermometer size={18} /> Temperature Alert Monitoring
          </h3>
          <p className="mt-1 text-xs text-[#8aa0ba]">
            Explainable cold-chain rules — software prototype, not a vaccine safety determination. Normal readings do not automatically release quarantine.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#dbe6f2] px-3 py-1.5 text-xs font-semibold text-[#4b6b90] hover:bg-[#f4f8fd] disabled:opacity-60">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {canManage ? <ColdChainPolicyForm canReview={canReview} onChange={load} /> : null}
      {pendingAction ? <form className="mb-4 rounded border border-amber-200 p-3" onSubmit={event => { event.preventDefault(); runAction(pendingAction.alert, pendingAction.action); }}><fieldset disabled={!!actionId} className="min-w-0 space-y-2">
        <p>{pendingAction.action.toUpperCase()} — {pendingAction.alert.batchId}</p>
        {pendingAction.action === "action-taken" ? <label className="block">Response action<select aria-label="Response action" value={pendingAction.actionTaken} onChange={e => setPendingAction({ ...pendingAction, actionTaken: e.target.value })} className="mt-1 block w-full rounded border p-2"><option value="inspect">Inspect shipment</option><option value="reroute">Reroute shipment</option><option value="hold">Place/confirm hold</option><option value="discard-review">Request discard review</option></select></label> : null}
        <label className="block">Action note<textarea aria-label="Action reason" required minLength={3} maxLength={2000} className="block w-full rounded border p-2" value={pendingAction.reason} onChange={e => setPendingAction({ ...pendingAction, reason: e.target.value })} /></label>
        {["review", "clear"].includes(pendingAction.action) ? <label className="block">Evidence simulation clock<input aria-label="Evidence simulation clock" required value={pendingAction.asOf} onChange={e => setPendingAction({ ...pendingAction, asOf: e.target.value })} className="mt-1 block w-full rounded border p-2" /></label> : null}
        <p className="text-xs">Review the policy, complete history, and device reliability. Clearing removes this event's hold only.</p>
        <button disabled={!!actionId} className="rounded bg-blue-700 px-3 py-2 text-white">Confirm {pendingAction.action}</button>
        <button type="button" className="ml-2 rounded border px-3 py-2" onClick={() => setPendingAction(null)}>Cancel action</button>
      </fieldset></form> : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Active alerts" value={summary.active || 0} tone="bg-rose-50 text-rose-700" />
        <SummaryCard label="Critical" value={summary.critical || 0} tone="bg-rose-100 text-rose-800" />
        <SummaryCard label="Warning" value={summary.warning || 0} tone="bg-amber-50 text-amber-700" />
        <SummaryCard label="Resolved history" value={summary.resolved || 0} tone="bg-emerald-50 text-emerald-700" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
        <select aria-label="Alert status filter" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="rounded-lg border border-[#dbe6f2] px-3 py-2 text-sm text-[#526a86]">
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="ACKNOWLEDGED">Acknowledged</option><option value="RESOLVED">Resolved</option>
        </select>
        <select aria-label="Alert severity filter" value={filters.severity} onChange={(event) => setFilters({ ...filters, severity: event.target.value })} className="rounded-lg border border-[#dbe6f2] px-3 py-2 text-sm text-[#526a86]">
          <option value="">All severities</option><option value="CRITICAL">Critical</option><option value="WARNING">Warning</option>
        </select>
        <input aria-label="Batch filter" value={filters.batchId} onChange={(event) => setFilters({ ...filters, batchId: event.target.value })} placeholder="Batch ID" className="rounded-lg border border-[#dbe6f2] px-3 py-2 text-sm" />
        <input aria-label="From date filter" type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className="rounded-lg border border-[#dbe6f2] px-3 py-2 text-sm" />
        <div className="flex gap-2"><input aria-label="To date filter" type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className="min-w-0 flex-1 rounded-lg border border-[#dbe6f2] px-3 py-2 text-sm" /><button type="button" onClick={applyFilters} className="rounded-lg bg-[#2f8ae0] px-3 py-2 text-xs font-semibold text-white">Apply</button></div>
      </div>
      <button type="button" onClick={clearFilters} className="mb-4 text-xs font-semibold text-[#3278d7]">Clear filters</button>
      {filterError && <p role="alert" className="mb-3 text-sm text-red-700">{filterError}</p>}

      {error ? <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {loading && !alerts.length ? <div className="rounded-xl border border-dashed border-[#d7e0eb] p-6 text-center text-sm text-[#8aa0ba]">Loading temperature alerts…</div> : null}
      {!loading && !error && !alerts.length ? <div className="rounded-xl border border-dashed border-[#d7e0eb] p-6 text-center text-sm text-[#8aa0ba]">No temperature alerts match these filters.</div> : null}

      {!error && alerts.length ? (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <article key={alert.alertId} className="rounded-xl border border-[#edf2f8] p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <button type="button" aria-expanded={selectedAlert?.alertId === alert.alertId} onClick={() => selectAlert(alert)} className="min-w-0 break-words text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#42566f]">{alert.batchId || "Unassigned batch"}</span>
                    <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${alert.severity === "CRITICAL" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{alert.severity}</span>
                    <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${alert.responseState === "RESOLVED" || alert.status === "RESOLVED" ? "bg-emerald-50 text-emerald-700" : alert.responseState === "OPEN" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{alert.responseState || (alert.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : alert.status === "RESOLVED" ? "RESOLVED" : "OPEN")}</span>
                    {alert.escalated ? <span role="status" aria-label="Escalated alert" className="rounded-md bg-rose-100 px-2 py-1 text-[11px] font-bold text-rose-800">Escalated</span> : null}
                  </div>
                  <p className="mt-2 text-sm text-[#526a86]">{alert.reason}</p>
                  <p className="mt-1 text-sm font-semibold">{alert.phase?.replaceAll("_", " ")} — {alert.recommendedAction}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#7c8da3]">
                    <span>Device {alert.deviceId || "--"}</span><span>Vehicle {alert.vehicleId || "--"}</span><span>{dateTime(alert.timestamp)}</span>
                  </div>
                </button>
                {canManage && (alert.responseState || "OPEN") !== "RESOLVED" ? <fieldset disabled={Boolean(actionId) || Boolean(pendingAction)} className="flex min-w-0 shrink-0 flex-wrap gap-2">
                  {(alert.responseState || "OPEN") === "OPEN" ? <button type="button" onClick={() => prepareAction(alert, "acknowledge")} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 disabled:opacity-60">Acknowledge</button> : null}
                  {alert.responseState === "ACKNOWLEDGED" ? <button type="button" onClick={() => prepareAction(alert, "action-taken")} className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">Record action taken</button> : null}
                  {canReview && alert.responseState === "ACTION_TAKEN" ? <><button type="button" disabled={!alert.excursionClosedAt} title={!alert.excursionClosedAt ? "Wait for the excursion to close with current in-policy evidence" : "Record quality review"} onClick={() => prepareAction(alert, "review")} className="rounded border px-3 py-2 text-xs disabled:opacity-50">Record quality review</button><button type="button" disabled={!alert.excursionClosedAt || !alert.reviewedBy} title={!alert.excursionClosedAt ? "Wait for in-policy recovery" : !alert.reviewedBy ? "Record an authorized quality review first" : "Clear this event's hold"} onClick={() => prepareAction(alert, "clear")} className="rounded bg-emerald-700 px-3 py-2 text-xs text-white disabled:opacity-50">Clear after review</button></> : null}
                </fieldset> : null}
              </div>
              {alert.deepLink ? <a href={alert.deepLink} className="mt-2 inline-block text-xs font-semibold text-blue-700 underline">Open shipment timeline / Batch Story</a> : null}
              {selectedAlert?.alertId === alert.alertId ? <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg bg-[#f8fbff] p-3 text-sm text-[#526a86] md:grid-cols-2">
                <div><b>Vaccine:</b> {alert.vaccineType || alert.context?.vaccineType || "--"}</div><div><b>Current temperature:</b> {temperature(alert.currentTemperature)}</div>
                <div><b>Allowed temperature range:</b> {temperature(alert.minimumAllowedTemperature)} – {temperature(alert.maximumAllowedTemperature)}</div>
                <div><b>Current humidity:</b> {alert.currentHumidity == null ? "--" : `${alert.currentHumidity}%`}</div>
                {alert.metric === "HUMIDITY" ? <><div><b>Allowed humidity range:</b> {alert.minimumAllowedHumidity ?? "--"}% – {alert.maximumAllowedHumidity ?? "--"}%</div><div><b>Breached limit:</b> {alert.breachedLimit ?? "--"}%</div></> : alert.metric === "TEMPERATURE" ? <div><b>Breached limit:</b> {alert.breachedLimit ?? "--"}°C</div> : null}
                <div><b>Shipment:</b> {alert.shipmentId || "--"}</div><div><b>Violation:</b> {alert.violationType}</div>
                <div><b>Excursion began:</b> {dateTime(alert.excursionStartedAt)}</div><div><b>Latest reading:</b> {dateTime(alert.latestReadingAt)}</div>
                <div className="md:col-span-2 flex items-center gap-2"><MapPin size={14} /> <b>Simulated location:</b> {alert.latitude ?? "--"}, {alert.longitude ?? "--"}</div>
                <div><b>Minimum observed:</b> {temperature(alert.minimumExcursionTemperature)}</div><div><b>Maximum observed:</b> {temperature(alert.maximumExcursionTemperature)}</div>
                <div><b>Humidity:</b> {alert.context?.humidity ?? "Unknown"}%</div><div><b>Battery:</b> {alert.context?.batteryLevel ?? "Unknown"}%</div>
                <div><b>Confidence:</b> {alert.confidence?.level || "Unknown"} — {alert.confidence?.basis}</div>
                <div><b>Measured excursion:</b> {(alert.excursionDurationMs || 0) / 60000} minutes</div>
                <div><b>Policy source:</b> {alert.policySnapshot?.sourceReference || "Legacy/unapproved"}</div>
                <div><b>Reading source:</b> {alert.context?.source === "manual-override" ? `Manual override${alert.context?.overrideId ? ` · ${alert.context.overrideId}` : ""}` : alert.context?.source === "auto-simulated" ? "Automatic simulator" : alert.context?.source || "Unknown"}</div>
                <div><b>Notification targets:</b> {(alert.notificationTargets || []).join(", ")}</div>
                <div className="break-words md:col-span-2"><b>Append-only audit history:</b>{auditLoading ? <p role="status">Loading audit history…</p> : auditTrail.map(entry => <p key={entry._id}>{entry.action} — {entry.reason} — simulation time {dateTime(entry.eventTime)} — recorded {dateTime(entry.recordedAt)} — {entry.actorId}</p>)}</div>
                {alert.resolutionReason ? <div className="md:col-span-2"><b>Resolution:</b> {alert.resolutionReason}</div> : null}
              </div> : null}
            </article>
          ))}
        </div>
      ) : null}

      <div className="mt-5 border-t border-[#edf2f8] pt-4">
        <h4 className="flex items-center gap-2 font-semibold text-[#42566f]"><Bell size={16} /> Application Notifications</h4>
        <div className="mt-3 space-y-2">
          {notifications.slice(0, 6).map((notification) => <div key={notification._id} className={`rounded-lg border px-3 py-2 text-sm ${notification.read ? "border-[#edf2f8] bg-white text-[#7c8da3]" : "border-blue-100 bg-blue-50 text-[#42566f]"}`}>
            <button type="button" disabled={notification.read || readingNotification === notification._id} title={notification.read ? "Notification read" : "Mark notification as read"} onClick={() => markRead(notification)} className="block w-full text-left disabled:cursor-default"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{notification.title}</span>{notification.read ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertTriangle size={15} className="text-amber-600" />}</div><p className="mt-1 text-xs">{notification.message}</p></button>
            {notification.metadata?.deepLink ? <a href={notification.metadata.deepLink} className="mt-2 inline-block text-xs font-semibold text-blue-700 underline">Open shipment timeline / Batch Story</a> : null}
          </div>)}
          {!notifications.length ? <div className="text-sm text-[#8aa0ba]">No temperature application notifications.</div> : null}
        </div>
      </div>
    </section>
  );
}
