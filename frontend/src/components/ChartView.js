import React from "react";
import DistributionDecisionChart from "./DistributionDecisionChart";

export default function ChartView({ decision }) {
  return <section className="rounded-xl border bg-white p-5">
    <h2 className="mb-3 text-lg font-semibold">Distribution planning analytics</h2>
    <DistributionDecisionChart decision={decision} />
  </section>;
}
