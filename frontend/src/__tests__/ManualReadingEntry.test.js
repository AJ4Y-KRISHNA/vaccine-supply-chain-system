import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ManualReadingEntry from "../components/ManualReadingEntry";
import API from "../services/api";

jest.mock("../services/api", () => ({ __esModule: true, default: { post: jest.fn() } }));

test("shows bounded manual-entry fields and marks the provenance", () => {
  render(<ManualReadingEntry />);
  expect(screen.getByRole("region", { name: "Manual telemetry entry" })).toBeInTheDocument();
  expect(screen.getByText("Manual", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByLabelText("Temperature (°C)")).toHaveAttribute("min", "-40");
  expect(screen.getByLabelText("Temperature (°C)")).toHaveAttribute("max", "60");
  expect(screen.getByLabelText("Operator note (required)")).toBeRequired();
});

test("renders the per-row CSV acceptance and rejection report", async () => {
  API.post.mockResolvedValue({ data: { accepted: 1, rejected: 1, results: [
    { row: 2, status: "accepted", source: "csv", readingId: "r-1" },
    { row: 3, status: "rejected", reason: "temperature must be less than or equal to 60" },
  ] } });
  render(<ManualReadingEntry />);
  const file = new File(["batchId,temperature\nSYNTHETIC-BATCH-001,5"], "readings.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText(/Upload CSV/), { target: { files: [file] } });
  await waitFor(() => expect(API.post).toHaveBeenCalledWith("/readings/import", file, { headers: { "Content-Type": "text/csv" } }));
  expect(await screen.findByText(/1 accepted, 1 rejected/)).toBeInTheDocument();
  expect(screen.getByText("temperature must be less than or equal to 60")).toBeInTheDocument();
  expect(screen.getAllByText("CSV").length).toBeGreaterThanOrEqual(1);
});

test("healthcare variant exposes CSV import without unauthorized manual-entry fields", () => {
  render(<ManualReadingEntry allowManual={false} />);
  expect(screen.queryByLabelText("Temperature (°C)")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Upload CSV/)).toBeInTheDocument();
});
