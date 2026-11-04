import React from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

export default function DistributionDecisionChart({ decision }) {
  if (!decision || ![decision.forecast_demand, decision.recommended_distribution].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    return <p className="rounded-lg border border-dashed p-4 text-sm text-slate-600">No distribution recommendation is available to chart.</p>;
  }
  return <div className="h-64 min-w-0" aria-label="Forecast demand and recommended supply">
    <Bar data={{ labels: ["Forecast demand", "Recommended supply"], datasets: [{ label: "Planning estimate (doses)", data: [decision.forecast_demand, decision.recommended_distribution], backgroundColor: ["#2563eb", "#059669"], borderRadius: 6 }] }} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }} />
  </div>;
}
