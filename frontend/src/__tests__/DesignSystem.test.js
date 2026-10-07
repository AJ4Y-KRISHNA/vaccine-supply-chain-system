import React from "react";
import { render, screen } from "@testing-library/react";
import StatusBadge from "../components/StatusBadge";
import ForecastExplanation from "../components/ForecastExplanation";

test("status badges use consistent semantic tones for safety and workflow states", () => {
  const { rerender } = render(<StatusBadge value="Quarantined — pending quality review" />);
  expect(screen.getByText("Quarantined — pending quality review")).toHaveClass("ui-status-danger");

  rerender(<StatusBadge value="Delivered" />);
  expect(screen.getByText("Delivered")).toHaveClass("ui-status-success");

  rerender(<StatusBadge value="Pending review" />);
  expect(screen.getByText("Pending review")).toHaveClass("ui-status-warning");
});

test("forecast explanation presents a loading state and a useful empty state", () => {
  const { rerender } = render(<ForecastExplanation loading />);
  expect(screen.getByRole("status", { name: "Loading forecast explanation" })).toBeInTheDocument();
  expect(screen.getByRole("group")).toHaveAttribute("aria-busy", "true");

  rerender(<ForecastExplanation />);
  expect(screen.getByText("The detailed explanation is unavailable for this forecast response.")).toBeInTheDocument();
});
