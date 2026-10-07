import React from "react";
import { render, screen } from "@testing-library/react";
import TraceabilityPanel from "../components/TraceabilityPanel";
import { fetchBatchJourney, fetchTraceabilityBatches } from "../services/traceability";

jest.mock("react-chartjs-2", () => ({ Line: () => <div>Temperature history chart</div> }));
jest.mock("../services/traceability", () => ({ fetchBatchJourney: jest.fn(), fetchTraceabilityBatches: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  fetchTraceabilityBatches.mockResolvedValue({ batches: [{ batchId: "STORY-1", vaccineType: "Synthetic demo vaccine" }] });
  fetchBatchJourney.mockResolvedValue({
    batch: { batchId: "STORY-1", vaccineType: "Synthetic demo vaccine", quantity: 12, status: "Ready",
      disposition: { status: "discarded", reason: "Synthetic test only", recordedAt: "2026-01-01T00:04:00.000Z" } },
    policy: { minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 40, maximumHumidity: 80, excursionDurationMs: 120000,
      maximumReadingGapMs: 90000, sourceReference: "Synthetic fixture; not a storage policy" },
    policies: [{ id: "policy-1", minimumTemperature: 2, maximumTemperature: 8 }],
    readings: [{ id: "r-1", recordedAt: "2026-01-01T00:01:00.000Z", temperature: 5, humidity: 55, batteryLevel: 90, latitude: 9, longitude: 76, deviceId: "sensor-1" }],
    alerts: [],
    events: [
      { id: "created", kind: "batch", title: "Vaccine batch created", at: "2026-01-01T00:00:00.000Z", role: "Manufacturer", actor: "Maker A", detail: "12 doses" },
      { id: "quarantined", kind: "audit", title: "QUARANTINE AUTHORIZED", at: "2026-01-01T00:02:00.000Z", role: "Admin", actor: "Reviewer", detail: "Synthetic excursion" },
      { id: "disposed", kind: "disposition", title: "Batch disposition set: discarded", at: "2026-01-01T00:04:00.000Z", role: "Admin", actor: "Reviewer", detail: "Synthetic test only" },
    ],
    blockchain: { status: "available", references: [{ source: "Shipment", label: "In Transit", txHash: `0x${"a".repeat(64)}`, timestamp: "2026-01-01T00:03:00.000Z" }], lifecycle: [] },
    forecast: { source: "Inventory certificate", predictedDemand: 21, certificateId: "CERT-STORY-1", issuedAt: "2025-12-31T23:00:00.000Z" },
  });
});

test("Batch Story renders chronological workflow, sensor policy context, disposition, chain references and forecast", async () => {
  render(<TraceabilityPanel />);
  expect(await screen.findByRole("region", { name: "Batch Story" })).toBeInTheDocument();
  expect(await screen.findByText("Vaccine batch created")).toBeInTheDocument();
  expect(screen.getByText("Temperature history chart")).toBeInTheDocument();
  expect(screen.getByText("Terminal disposition: discarded")).toBeInTheDocument();
  expect(screen.getByText("Blockchain references")).toBeInTheDocument();
  expect(screen.getByText(`0x${"a".repeat(64)}`)).toBeInTheDocument();
  expect(screen.getByText("Production-time forecast context")).toBeInTheDocument();
  expect(screen.getByText("21")).toBeInTheDocument();
  const created = screen.getByText("Vaccine batch created");
  const disposition = screen.getByText("Batch disposition set: discarded");
  expect(created.compareDocumentPosition(disposition) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fetchBatchJourney).toHaveBeenCalledWith("STORY-1");
});

test("Batch Story hides manufacturer-only forecast context when the scoped response omits it", async () => {
  fetchBatchJourney.mockResolvedValueOnce({ batch: { batchId: "STORY-1", vaccineType: "Synthetic demo vaccine", quantity: 12, disposition: { status: "active" } },
    policy: null, readings: [], alerts: [], events: [], blockchain: { status: "scoped", references: [], lifecycle: [] }, forecast: null });
  render(<TraceabilityPanel />);
  expect(await screen.findByText("STORY-1")).toBeInTheDocument();
  expect(screen.queryByText("Production-time forecast context")).not.toBeInTheDocument();
});

test("Batch Story shows a clear empty state when the account has no visible batches", async () => {
  fetchTraceabilityBatches.mockResolvedValueOnce({ batches: [] });
  render(<TraceabilityPanel />);
  expect(await screen.findByText("No batches are currently visible to your signed-in role.")).toBeInTheDocument();
  expect(fetchBatchJourney).not.toHaveBeenCalled();
});

test("Batch Story exposes its loading skeleton while journey data is being fetched", async () => {
  fetchBatchJourney.mockImplementation(() => new Promise(() => {}));
  render(<TraceabilityPanel />);
  expect(await screen.findByRole("status", { name: "Loading batch journey" })).toBeInTheDocument();
});
