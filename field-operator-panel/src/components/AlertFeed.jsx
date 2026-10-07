import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bell, Check, ExternalLink, ShieldAlert } from "lucide-react";

const SEVERITY_STYLES = {
  critical: {
    label: "Critical",
    container: "border-danger/40 bg-danger/5",
    text: "text-danger",
    icon: "text-danger",
  },
  warning: {
    label: "Warning",
    container: "border-warning/40 bg-warning/5",
    text: "text-warning",
    icon: "text-warning",
  },
  info: {
    label: "Information",
    container: "border-accent/30 bg-accent/5",
    text: "text-accent",
    icon: "text-accent",
  },
};

function severityStyle(value) {
  const severity = String(value || "warning").toLowerCase();
  if (severity === "critical" || severity === "high") return SEVERITY_STYLES.critical;
  if (severity === "info" || severity === "informational") return SEVERITY_STYLES.info;
  return SEVERITY_STYLES.warning;
}

function formatAlertTime(value) {
  if (!value) return "Simulation time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function CriticalAlertBanner({ alert }) {
  const reduceMotion = useReducedMotion();
  if (!alert || alert.status === "RESOLVED" || severityStyle(alert.severity) !== SEVERITY_STYLES.critical) return null;

  return (
    <motion.div
      initial={false}
      animate={reduceMotion ? { opacity: 1 } : { opacity: [1, 0.78, 1] }}
      transition={
        reduceMotion ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
      }
      className="mb-5 flex items-start gap-3 rounded-input border border-danger/50 bg-danger/10 p-4 text-text-primary"
      role="alert"
      aria-live="assertive"
    >
      <ShieldAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-danger">Unacknowledged critical event</p>
        <p className="mt-1 text-sm leading-5">{alert.message}</p>
        <p className="operator-mono mt-2 text-xs text-text-secondary">
          {alert.shipmentId || "Shipment unavailable"} · {formatAlertTime(alert.simulationClock)}
        </p>
      </div>
    </motion.div>
  );
}

export default function AlertFeed({ alerts, shipmentId, onAcknowledge }) {
  const reduceMotion = useReducedMotion();
  const mainSystemUrl = import.meta.env.VITE_MAIN_APP_URL || "http://localhost:3000";
  const sortedAlerts = [...alerts].reverse();
  const openCount = alerts.filter((alert) => !alert.acknowledged && alert.status !== "RESOLVED").length;
  const acknowledgedCount = alerts.filter((alert) => alert.acknowledged).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Alert counts">
        <span className="rounded-pill border border-danger/30 bg-danger/5 px-3 py-1 text-xs text-danger">
          Unacknowledged: {openCount}
        </span>
        <span className="rounded-pill border border-border px-3 py-1 text-xs text-text-secondary">
          Acknowledged: {acknowledgedCount}
        </span>
        <span className="rounded-pill border border-border px-3 py-1 text-xs text-text-secondary">
          Loaded: {alerts.length} (up to 30 saved events)
        </span>
      </div>

      {!alerts.length ? (
        <div className="flex items-start gap-3 rounded-input border border-border bg-background/60 p-4">
          <Bell aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <div>
            <p className="text-sm font-medium text-text-secondary">No alert events received</p>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              This means no alert message has been loaded; it does not mean that the shipment is
              within its approved limits.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="max-h-[34rem] space-y-3 overflow-y-auto pr-1"
          aria-label="Alert events"
          aria-live="polite"
          aria-relevant="additions"
        >
          <AnimatePresence initial={false}>
            {sortedAlerts.map((alert) => {
              const style = severityStyle(alert.severity);
              const url = shipmentId
                ? `${mainSystemUrl.replace(/\/$/, "")}/live-shipments?shipmentId=${encodeURIComponent(shipmentId)}`
                : null;

              return (
                <motion.article
                  key={alert.alertId}
                  initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: reduceMotion ? 0 : 0.18 }}
                  className={`rounded-input border p-4 ${style.container} ${alert.acknowledged ? "opacity-75" : ""}`}
                  aria-label={`${style.label} alert: ${alert.message}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={`mt-0.5 rounded-pill border border-current/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${style.text}`}
                      >
                        {style.label}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-5 text-text-primary">
                          {alert.message}
                        </p>
                        <p className="operator-mono mt-2 break-words text-xs text-text-secondary">
                          {alert.metric}: {alert.value ?? "Unavailable"}
                          {alert.limit !== null && alert.limit !== undefined
                            ? ` · limit ${alert.limit}`
                            : ""}
                          {alert.duration !== null && alert.duration !== undefined
                            ? ` · ${alert.duration} min`
                            : ""}
                        </p>
                        <p className="mt-1 text-xs text-text-muted">
                          {alert.shipmentId || "Shipment unavailable"} ·{" "}
                          {formatAlertTime(alert.simulationClock)}
                        </p>
                      </div>
                    </div>
                    {!alert.acknowledged && (
                      <button
                        type="button"
                        onClick={() => onAcknowledge(alert.alertId)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-input border border-border bg-surface px-3 text-xs font-medium text-text-primary hover:border-primary/60 hover:text-primary"
                      >
                        <Check aria-hidden="true" className="h-3.5 w-3.5" />
                        Acknowledge locally
                      </button>
                    )}
                    {alert.acknowledged && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                        <Check aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
                        Acknowledged locally
                      </span>
                    )}
                  </div>
                  {url && (
                    <a
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View shipment in main system
                      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                    </a>
                  )}
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      <p className="mt-3 text-xs leading-5 text-text-muted" role="note">
        Acknowledgement is held only in this panel&apos;s memory, is lost on reload or shipment
        change, and is not sent to the backend or treated as alert resolution.
      </p>
    </>
  );
}

export function getUnreadAlertCount(alerts = []) {
  return alerts.filter((alert) => !alert.read && alert.status !== "RESOLVED").length;
}
