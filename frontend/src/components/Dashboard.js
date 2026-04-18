import React from "react";
import DistributionForm from "./DistributionForm";
import ChartView from "./ChartView";
import BlockchainLog from "./BlockchainLog";

export default function Dashboard() {
  return (
    <div>
      <h1>🚀 Vaccine Supply Chain Dashboard</h1>

      <DistributionForm />
      <ChartView />
      <BlockchainLog />
    </div>
  );
}