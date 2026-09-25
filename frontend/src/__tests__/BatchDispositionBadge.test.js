import React from "react";
import { render, screen } from "@testing-library/react";
import BatchDispositionBadge from "../components/BatchDispositionBadge";

test("legacy batches without a disposition display as active", () => {
  render(<BatchDispositionBadge />);
  expect(screen.getByText("Disposition: active")).toBeInTheDocument();
});

test("terminal disposition shows its reason code and recorded time", () => {
  render(<BatchDispositionBadge disposition={{ status: "recalled", reasonCode: "MANUFACTURER_RECALL", recordedAt: "2026-09-24T10:00:00.000Z" }} />);
  expect(screen.getByText("Disposition: recalled")).toBeInTheDocument();
  expect(screen.getByText("MANUFACTURER_RECALL")).toBeInTheDocument();
  expect(screen.getByText(/^Recorded /)).toBeInTheDocument();
});
