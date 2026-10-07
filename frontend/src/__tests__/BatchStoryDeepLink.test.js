import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import TraceabilityPanel from "../components/TraceabilityPanel";
import { fetchBatchJourney, fetchTraceabilityBatches } from "../services/traceability";

jest.mock("../services/traceability", () => ({ fetchBatchJourney: jest.fn(), fetchTraceabilityBatches: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  fetchTraceabilityBatches.mockResolvedValue({ batches: [
    { batchId: "B-1", vaccineType: "Demo one" }, { batchId: "B-2", vaccineType: "Demo two" },
  ] });
  fetchBatchJourney.mockImplementation(async batchId => ({ batch: { batchId }, policy: null, events: [], readings: [], alerts: [], blockchain: { status: "scoped", references: [] } }));
});

test("Batch Story automatically selects the batch named by an alert deep link", async () => {
  window.history.replaceState({}, "", "/admin?batchId=B-2#shipment-journey");
  render(<TraceabilityPanel />);
  await waitFor(() => expect(screen.getByLabelText("Traceability batch")).toHaveValue("B-2"));
  await waitFor(() => expect(fetchBatchJourney).toHaveBeenCalledWith("B-2"));
  window.history.replaceState({}, "", "/");
});
