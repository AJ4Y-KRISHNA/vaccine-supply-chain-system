import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BlockchainLog from "../components/BlockchainLog";
import { fetchBatchAuditAnchors, fetchBatchLifecycle, fetchBatchOnChainTelemetry } from "../services/blockchain";
jest.mock("../services/blockchain", () => ({ fetchBatchAuditAnchors: jest.fn(), fetchBatchLifecycle: jest.fn(), fetchBatchOnChainTelemetry: jest.fn() }));

beforeEach(() => {
  jest.resetAllMocks();
  fetchBatchLifecycle.mockImplementation(async batchId => ({ batch: { batchId, status: "Registered" }, timeline: [], transactions: [] }));
  fetchBatchAuditAnchors.mockResolvedValue({ entries: [] });
  fetchBatchOnChainTelemetry.mockResolvedValue({ batchId: "BATCH-A", chainId: 31337, contractAddress: "0x" + "1".repeat(40),
    total: 0, offset: 0, readings: [], nextOffset: null });
});

test("selected batch shows verified temperature-history and audit evidence digests", async () => {
  fetchBatchAuditAnchors.mockResolvedValue({ entries: [
    { kind: "temperature-reading", recordId: "reading-1", recordedAt: "2026-01-01T00:00:00Z", verified: true,
      anchor: { status: "confirmed", txHash: "0x" + "a".repeat(64), digest: "0x" + "b".repeat(64) },
      rawChain: { status: "confirmed", verified: true, txHash: "0x" + "c".repeat(64), digest: "0x" + "d".repeat(64), reading: { temperature: 5.25, humidity: 54, batteryLevel: 99 } } },
    { kind: "audit", recordId: "audit-1", action: "QUARANTINE", recordedAt: "2026-01-01T00:01:00Z", verified: false, anchor: null },
  ] });
  render(<BlockchainLog batchIds={["BATCH-A"]} pollingMs={0} />);
  const panel = await screen.findByRole("region", { name: "Cold-chain history anchors" });
  expect(within(panel).getByText("Raw temperature record")).toBeInTheDocument();
  expect(within(panel).getByText("5.25°C · 54% RH · 99% battery")).toBeInTheDocument();
  expect(within(panel).getByText(/Verified on local chain/)).toBeInTheDocument();
  expect(within(panel).getByText("QUARANTINE")).toBeInTheDocument();
  expect(panel).toHaveTextContent("1 verified · 1 pending · 0 needs attention");
  expect(fetchBatchAuditAnchors).toHaveBeenCalledWith("BATCH-A");
});

test("the audit panel reads complete raw telemetry directly from the on-chain history endpoint", async () => {
  fetchBatchOnChainTelemetry.mockResolvedValue({ batchId: "BATCH-A", chainId: 31337, contractAddress: "0x" + "1".repeat(40),
    total: 1, offset: 0, readings: [{ recordId: "reading-1", digest: "0x" + "d".repeat(64), recordedAt: "2026-01-01T00:00:00Z",
      temperature: 5.25, humidity: 54, batteryLevel: 99, deviceId: "DEVICE", vehicleId: "TRUCK", location: { lat: 9.93, lng: 76.26 } }], nextOffset: null });
  render(<BlockchainLog batchIds={["BATCH-A"]} pollingMs={0} />);
  const details = await screen.findByText(/Read sensor history directly from local contract/);
  fireEvent.click(details);
  expect(await screen.findByText(/GPS 9.93, 76.26/)).toBeInTheDocument();
  expect(fetchBatchOnChainTelemetry).toHaveBeenCalledWith("BATCH-A");
});

test("selection, search and refresh inspect the selected matching batch", async () => {
  render(<BlockchainLog batchIds={["BATCH-A", "BATCH-B"]} enableSearch pollingMs={0} />);
  await screen.findByText("Registered");
  fireEvent.change(screen.getByLabelText("Search blockchain batches"), { target: { value: "BATCH-B" } });
  await waitFor(() => expect(fetchBatchLifecycle).toHaveBeenLastCalledWith("BATCH-B"));
  expect(screen.getByLabelText("Blockchain batch")).toHaveValue("BATCH-B");
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh blockchain timeline" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Refresh blockchain timeline" }));
  await waitFor(() => expect(fetchBatchLifecycle).toHaveBeenCalledTimes(3));
  fireEvent.change(screen.getByLabelText("Search blockchain batches"), { target: { value: "absent" } });
  expect(screen.getByText("No batches match that search.")).toBeInTheDocument();
  expect(screen.queryByText("Registered")).not.toBeInTheDocument();
});

test("loading and failed fetch are visible and refresh can recover", async () => {
  fetchBatchLifecycle.mockRejectedValueOnce(new Error("Offline"));
  render(<BlockchainLog batchIds={["BATCH-A"]} pollingMs={0} />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading blockchain timeline");
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Refresh blockchain timeline" }));
  await screen.findByText("Registered");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("no batch disables refresh and explains the empty state", () => {
  render(<BlockchainLog pollingMs={0} />);
  expect(screen.getByRole("button", { name: "Refresh blockchain timeline" })).toBeDisabled();
  expect(screen.getByText("No blockchain-audited batches available yet.")).toBeInTheDocument();
  expect(fetchBatchLifecycle).not.toHaveBeenCalled();
});
