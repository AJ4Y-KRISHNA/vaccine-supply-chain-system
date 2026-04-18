import React, { useState } from "react";
import { distribute } from "../services/api";

export default function DistributionForm() {
  const [form, setForm] = useState({
    batchId: 1,
    sentiment_score: 0.8,
    forecast_demand: 10000,
    historical_supply: "8000,9000,8500"
  });

  const [result, setResult] = useState(null);

  const handleSubmit = async () => {
    const payload = {
      ...form,
      historical_supply: form.historical_supply.split(",").map(Number)
    };

    const res = await distribute(payload);
    setResult(res.data);
  };

  return (
    <div>
      <h2>📦 Distribution</h2>

      <input placeholder="Batch ID"
        onChange={(e) => setForm({ ...form, batchId: e.target.value })} />

      <input placeholder="Sentiment"
        onChange={(e) => setForm({ ...form, sentiment_score: e.target.value })} />

      <input placeholder="Forecast Demand"
        onChange={(e) => setForm({ ...form, forecast_demand: e.target.value })} />

      <input placeholder="Historical Supply (comma)"
        onChange={(e) => setForm({ ...form, historical_supply: e.target.value })} />

      <button onClick={handleSubmit}>Distribute</button>

      {result && (
        <div>
          <p>✅ {result.message}</p>
          <p>TxHash: {result.txHash}</p>
        </div>
      )}
    </div>
  );
}