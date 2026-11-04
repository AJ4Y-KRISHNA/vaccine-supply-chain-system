import React, { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Droplets, Thermometer } from "lucide-react";

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayTime(value, index) {
  if (!value) return `Sample ${index + 1}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function withinRange(value, minimum, maximum) {
  return (
    value !== null && minimum !== null && maximum !== null && value >= minimum && value <= maximum
  );
}

function pointColor(point, metric, minimum, maximum) {
  const status = String(point.status || "").toLowerCase();
  if (status.includes("quarantin") || status.includes("critical")) return "var(--color-danger)";
  if (status.includes("review") || status.includes("warning") || status.includes("excursion")) {
    return "var(--color-warning)";
  }
  const value = numeric(point[metric]);
  if (value === null || minimum === null || maximum === null) return "var(--color-text-secondary)";
  if (!withinRange(value, minimum, maximum)) return "var(--color-warning)";
  const source = String(point.source || "").toLowerCase();
  if (source === "manual" || source === "manual-override") return "#8B5CF6";
  if (source === "csv") return "#38BDF8";
  return "var(--color-primary)";
}

function chartDomain(data, minimum, maximum) {
  const values = [...data.map((reading) => reading.value), minimum, maximum].filter(
    (value) => value !== null,
  );
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = high === low ? Math.max(Math.abs(high) * 0.05, 1) : (high - low) * 0.1;
  return [Number((low - padding).toFixed(2)), Number((high + padding).toFixed(2))];
}

function eventMarkers(history, alerts = []) {
  const points = history
    .map((reading, index) => {
      const time = new Date(reading.simulationClock || reading.recordedAt || reading.timestamp || "").getTime();
      return Number.isFinite(time) ? { time, label: displayTime(time, index) } : null;
    })
    .filter(Boolean);
  if (!points.length) return [];

  const start = points[0].time;
  const end = points[points.length - 1].time;
  const markers = [];
  const addMarker = (alert, timeValue, label, color) => {
    const time = new Date(timeValue || "").getTime();
    if (!Number.isFinite(time) || time < start || time > end) return;
    const nearest = points.reduce((best, point) =>
      Math.abs(point.time - time) < Math.abs(best.time - time) ? point : best,
    );
    markers.push({ x: nearest.label, label, color, key: `${alert.alertId || "alert"}-${label}-${time}` });
  };

  alerts.forEach((alert) => {
    addMarker(alert, alert.excursionStartedAt || alert.simulationClock, "Alert opened", "var(--color-warning)");
    if (alert.phase === "QUARANTINED" || alert.requiresQualityReview) {
      addMarker(alert, alert.simulationClock, "Quarantine", "var(--color-danger)");
    }
    if (["RECOVERED", "CLEARED"].includes(String(alert.phase || "").toUpperCase())) {
      addMarker(alert, alert.excursionClosedAt || alert.simulationClock, "Recovered", "var(--color-primary)");
    }
  });
  return markers.slice(-12);
}

function ChartDot({ cx, cy, payload, dataKey, minimum, maximum }) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r="4"
      fill={pointColor(payload, dataKey, minimum, maximum)}
      stroke="var(--color-background)"
      strokeWidth="2"
    ><title>{`${payload.source === "manual" ? "Manual" : payload.source === "csv" ? "CSV" : "Simulated"} reading · ${payload.value}`}</title></circle>
  );
}

function SensorChart({ title, metric, unit, icon: Icon, history, alerts, minimum, maximum }) {
  const hasPolicyRange = minimum !== null && maximum !== null;
  const data = history
    .map((reading, index) => ({
      ...reading,
      value: numeric(reading[metric]),
      label: displayTime(reading.simulationClock, index),
      index: index + 1,
    }))
    .filter((reading) => reading.value !== null);

  return (
    <section className="rounded-input border border-border bg-background/60 p-4" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
          <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
          {title}
        </div>
        <span className="operator-mono text-xs text-text-muted">{unit}</span>
      </div>
      <p className="mb-2 flex flex-wrap gap-2 text-[10px] text-text-muted"><span className="text-primary">● Simulated</span><span className="text-violet-400">● Manual</span><span className="text-sky-400">● CSV</span></p>
      {data.length ? (
        <div
          className="h-52 w-full"
          role="img"
          aria-label={`${title} chart for ${data.length} samples`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 14, bottom: 2, left: -14 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" opacity={0.55} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                axisLine={{ stroke: "var(--color-border)" }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                width={42}
                tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                domain={chartDomain(data, minimum, maximum)}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-surface-raised)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  color: "var(--color-text-primary)",
                }}
                labelStyle={{ color: "var(--color-text-secondary)" }}
                formatter={(value) => [`${Number(value).toFixed(2)} ${unit}`, title]}
              />
              {hasPolicyRange && (
                <>
                  <ReferenceLine
                    y={minimum}
                    stroke="var(--color-warning)"
                    strokeDasharray="5 4"
                    label={{
                      value: "Policy min",
                      fill: "var(--color-warning)",
                      fontSize: 9,
                      position: "insideTopLeft",
                    }}
                  />
                  <ReferenceLine
                    y={maximum}
                    stroke="var(--color-warning)"
                    strokeDasharray="5 4"
                    label={{
                      value: "Policy max",
                      fill: "var(--color-warning)",
                      fontSize: 9,
                      position: "insideTopLeft",
                    }}
                  />
                </>
              )}
              <Line
                type="monotone"
                dataKey="value"
                name={title}
                stroke="var(--color-accent)"
                strokeWidth={2}
                dot={<ChartDot dataKey={metric} minimum={minimum} maximum={maximum} />}
                activeDot={{ r: 6, fill: "var(--color-accent)" }}
                isAnimationActive={false}
                connectNulls={false}
              />
              {eventMarkers(history, alerts).map((marker) => (
                <ReferenceLine
                  key={marker.key}
                  x={marker.x}
                  stroke={marker.color}
                  strokeDasharray="2 3"
                  label={{
                    value: marker.label,
                    fill: marker.color,
                    fontSize: 9,
                    position: "insideTopRight",
                  }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-52 items-center justify-center rounded-input border border-dashed border-border px-4 text-center text-sm text-text-muted">
          No {title.toLowerCase()} samples received yet.
        </div>
      )}
      {hasPolicyRange ? (
        <p className="mt-2 text-xs text-text-muted">
          Configured policy range: {minimum}–{maximum} {unit}. Markers show observed readings, not a
          safety determination.
        </p>
      ) : (
        <p className="mt-2 text-xs text-warning">
          No approved {title.toLowerCase()} policy range was supplied; no safe band is inferred.
        </p>
      )}
    </section>
  );
}

export default function SensorHistoryCharts({ history = [], latestReading = null, alerts = [], policy = {} }) {
  const chartHistory = useMemo(() => {
    if (history.length) return history;
    return latestReading ? [latestReading] : [];
  }, [history, latestReading]);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <SensorChart
          title="Temperature history"
          metric="temperature"
          unit="°C"
          icon={Thermometer}
          history={chartHistory}
          alerts={alerts}
          minimum={numeric(policy.minimumTemperature)}
          maximum={numeric(policy.maximumTemperature)}
        />
        <SensorChart
          title="Humidity history"
          metric="humidity"
          unit="% RH"
          icon={Droplets}
          history={chartHistory}
          alerts={alerts}
          minimum={numeric(policy.minimumHumidity)}
          maximum={numeric(policy.maximumHumidity)}
        />
      </div>
      <p className="mt-3 text-xs text-text-muted">
        Charts include all saved readings loaded for this shipment plus newly received live samples.
        Vertical markers show alert, quarantine, and recovery events when they fall within the plotted
        history; point colors use available status and configured limits.
      </p>
    </>
  );
}

export { chartDomain, eventMarkers, pointColor };
