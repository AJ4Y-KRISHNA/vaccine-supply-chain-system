import React from "react";
import { Bar } from "react-chartjs-2";

export default function ChartView() {
  const data = {
    labels: ["Demand", "Supply"],
    datasets: [
      {
        label: "Distribution",
        data: [15000, 16500]
      }
    ]
  };

  return (
    <div>
      <h2>📊 Analytics</h2>
      <Bar data={data} />
    </div>
  );
}