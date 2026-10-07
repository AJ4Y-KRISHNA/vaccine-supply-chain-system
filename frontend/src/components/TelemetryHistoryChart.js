import React, { useMemo } from "react";
import SourceBadge from "./SourceBadge";

function pathFor(values, min, max) {
  if (!values.length) return "";
  return values.map((value, index) => `${index ? "L" : "M"} ${40 + index * (600 / Math.max(1, values.length - 1))} ${112 - ((value - min) / (max - min || 1)) * 88}`).join(" ");
}

export default function TelemetryHistoryChart({ records = [], policy = {}, shipmentId }) {
  const chart = useMemo(() => {
    const tempMin = Math.min(-5, Number(policy.minimumTemperature ?? 2) - 2, ...records.map(row => Number(row.temperature)).filter(Number.isFinite));
    const tempMax = Math.max(10, Number(policy.maximumTemperature ?? 8) + 2, ...records.map(row => Number(row.temperature)).filter(Number.isFinite));
    const humidityValues = records.map(row => row.humidity).filter(value => Number.isFinite(Number(value))).map(Number);
    return { temperatures: records.map(row => row.temperature).filter(value => Number.isFinite(Number(value))).map(Number), tempMin, tempMax,
      humidity: humidityValues, humidityMin: Math.min(0, Number(policy.minimumHumidity ?? 0), ...humidityValues), humidityMax: Math.max(100, Number(policy.maximumHumidity ?? 100), ...humidityValues) };
  }, [records, policy]);
  const low = Number(policy.minimumTemperature ?? 2), high = Number(policy.maximumTemperature ?? 8);
  const y = value => 112 - ((value - chart.tempMin) / (chart.tempMax - chart.tempMin || 1)) * 88;
  const bandTop = y(high), bandBottom = y(low);
  return <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3" aria-label={`Synthetic sensor history ${shipmentId || ""}`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-600"><span>Temperature history · °C</span><span className="font-normal">Allowed {low}–{high}°C · humidity {policy.minimumHumidity ?? "—"}–{policy.maximumHumidity ?? "—"}% RH</span></div>
    {records.length < 2 ? <p className="py-5 text-center text-xs text-slate-500">Waiting for enough saved synthetic sensor readings to chart.</p> : <>
      <svg viewBox="0 0 680 132" role="img" aria-label={`Temperature chart, approved range ${low} to ${high} degrees Celsius`} className="h-32 w-full">
        <rect x="40" y={bandTop} width="600" height={Math.max(0, bandBottom-bandTop)} fill="#d1fae5" />
        <path d={pathFor(chart.temperatures, chart.tempMin, chart.tempMax)} fill="none" stroke="#0f766e" strokeWidth="2.5" />
        {records.filter(row => Number.isFinite(Number(row.temperature))).map((row, index, points) => <TelemetryPoint key={row._id || row.id || index} row={row} cx={40 + index * (600 / Math.max(1, points.length-1))} cy={y(Number(row.temperature))} excursion={isOutside(Number(row.temperature), low, high)} />)}
        <text x="42" y="128" fontSize="10" fill="#64748b">Earlier</text><text x="600" y="128" fontSize="10" fill="#64748b">Latest</text>
      </svg>
      <div className="mb-1 mt-1 text-xs font-semibold text-slate-600">Humidity history · % RH</div>
      <svg viewBox="0 0 680 132" role="img" aria-label={`Humidity chart, approved range ${policy.minimumHumidity ?? 0} to ${policy.maximumHumidity ?? 100} percent`} className="h-28 w-full">
        {policy.minimumHumidity != null && policy.maximumHumidity != null ? <rect x="40" y={112-((Number(policy.maximumHumidity)-chart.humidityMin)/(chart.humidityMax-chart.humidityMin||1))*88} width="600" height={Math.max(0, ((Number(policy.maximumHumidity)-Number(policy.minimumHumidity))/(chart.humidityMax-chart.humidityMin||1))*88)} fill="#dbeafe" /> : null}
        <path d={pathFor(chart.humidity, chart.humidityMin, chart.humidityMax)} fill="none" stroke="#2563eb" strokeWidth="2.5" />
        {chart.humidity.map((value, index) => policy.minimumHumidity != null && policy.maximumHumidity != null && isOutside(value, Number(policy.minimumHumidity), Number(policy.maximumHumidity)) ? <circle key={index} cx={40 + index * (600 / Math.max(1, chart.humidity.length-1))} cy={112-((value-chart.humidityMin)/(chart.humidityMax-chart.humidityMin||1))*88} r="4" fill="#dc2626"><title>Humidity excursion: {value}%</title></circle> : null)}
        <text x="42" y="128" fontSize="10" fill="#64748b">Earlier</text><text x="600" y="128" fontSize="10" fill="#64748b">Latest</text>
      </svg>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500"><span>Point color identifies reading source; red points are policy excursions:</span>{["simulator", "manual", "csv"].map(source => <SourceBadge key={source} source={source} />)}</div>
    </>}
    <p className="mt-1 text-[10px] text-slate-400">Synthetic demonstration records; not for clinical or production use.</p>
  </div>;
}
function isOutside(value, low, high) { return value < low || value > high; }
function TelemetryPoint({ row, cx, cy, excursion }) {
  const source = String(row.source || "simulator").toLowerCase();
  const fill = excursion ? "#dc2626" : sourceColor(source);
  const title = <title>{sourceLabel(source)} reading: {row.temperature}°C{excursion ? " · policy excursion" : ""}</title>;
  if (source === "manual" || source === "manual-override") return <rect x={cx - 3.5} y={cy - 3.5} width="7" height="7" rx="1" fill={fill}>{title}</rect>;
  if (source === "csv") return <path d={`M ${cx} ${cy - 4} L ${cx + 4} ${cy + 3} L ${cx - 4} ${cy + 3} Z`} fill={fill}>{title}</path>;
  return <circle cx={cx} cy={cy} r={excursion ? "4.5" : "3"} fill={fill}>{title}</circle>;
}
function sourceLabel(value) { return ({ simulator: "Simulated", "auto-simulated": "Simulated", "software-iot-simulator": "Simulated", manual: "Manual", "manual-override": "Manual", csv: "CSV" }[String(value || "").toLowerCase()] || "Unknown source"); }
function sourceColor(value) { return ({ manual: "#7c3aed", "manual-override": "#7c3aed", csv: "#0284c7", simulator: "#059669", "auto-simulated": "#059669", "software-iot-simulator": "#059669" }[String(value || "").toLowerCase()] || "#64748b"); }
