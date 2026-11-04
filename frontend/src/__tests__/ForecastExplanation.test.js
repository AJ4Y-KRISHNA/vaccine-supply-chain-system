import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ForecastExplanation from "../components/ForecastExplanation";

const forecast = {
  predicted_demand: 20,
  explanation_breakdown: {
    methodology: "Rule-based explanation; not model-internal attribution.",
    selected_baseline: "mean_3",
    selection_basis: "Lowest prefix rolling MAE.",
    calculation: "(18 + 20 + 22) / 3 = 20; rounded up to 20",
    predicted_demand_doses: 20,
    inputs: [{ label: "Observation 1 of the latest 3", demand_doses: 18, contribution_doses: 6 }],
    recent_volume_trend: { description: "Latest observation is 4 doses above the prior average." },
    seasonality: { modeled: false, description: "No seasonal component is modeled." },
    supply_context: {
      status: "available",
      scope: "single vaccine type",
      vaccine_type: "Demo",
      current_available_stock_doses: 70,
      stock_description: "70 doses are eligible.",
      quarantine_description: "1 batch has an active quality hold; 30 doses are excluded from eligible stock.",
      interpretation: "Supply context does not change predicted demand.",
    },
  },
};

test("expandable forecast explanation shows model inputs, seasonality and quarantine supply context", () => {
  render(<ForecastExplanation forecast={forecast} />);
  fireEvent.click(screen.getByText("Why this number?"));

  expect(screen.getByText("Selected baseline:", { exact: false })).toBeInTheDocument();
  expect(screen.getByText(/Observation 1 of the latest 3: 18 doses/)).toBeInTheDocument();
  expect(screen.getByText("No seasonal component is modeled.")).toBeInTheDocument();
  expect(screen.getByText(/1 batch has an active quality hold; 30 doses are excluded/)).toBeInTheDocument();
  expect(screen.getByText(/not SHAP\/LIME or model-internal interpretability/)).toBeInTheDocument();
});

test("missing explanation is stated instead of fabricated", () => {
  render(<ForecastExplanation forecast={{ predicted_demand: 0 }} />);
  fireEvent.click(screen.getByText("Why this number?"));
  expect(screen.getByText("The detailed explanation is unavailable for this forecast response.")).toBeInTheDocument();
});
