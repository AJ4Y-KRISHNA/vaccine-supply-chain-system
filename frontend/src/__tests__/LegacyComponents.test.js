import React from "react";
import { render, screen } from "@testing-library/react";
import DistributionForm from "../components/DistributionForm";
import ChartView from "../components/ChartView";
import DistributionDecisionChart from "../components/DistributionDecisionChart";
jest.mock("react-chartjs-2", () => ({ Bar: ({ data }) => <div data-testid="chart">{JSON.stringify(data.datasets[0].data)}</div> }));

test("retired legacy distribution cannot bypass the authenticated workflow", () => {
  render(<DistributionForm />);
  expect(screen.getByText(/legacy forecast-only distribution form is retired/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("no data produces an honest empty chart instead of placeholder inventory", () => {
  render(<ChartView />);
  expect(screen.getByText("No distribution recommendation is available to chart.")).toBeInTheDocument();
  expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
});

test("chart uses only the supplied decision", () => {
  render(<DistributionDecisionChart decision={{ forecast_demand: 20, recommended_distribution: 15 }} />);
  expect(screen.getByTestId("chart")).toHaveTextContent("[20,15]");
});
