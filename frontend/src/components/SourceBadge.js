import React from "react";

const sourceLabel = value => ({ simulator: "Simulated", "auto-simulated": "Simulated", "software-iot-simulator": "Simulated", manual: "Manual", "manual-override": "Manual", csv: "CSV" }[String(value || "").toLowerCase()] || "Unknown source");
export default function SourceBadge({ source }) {
  const label = sourceLabel(source);
  const tone = label === "Manual" ? "bg-violet-100 text-violet-800" : label === "CSV" ? "bg-sky-100 text-sky-800" : label === "Simulated" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700";
  return <span title={`Data source: ${label}`} className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>{label}</span>;
}
