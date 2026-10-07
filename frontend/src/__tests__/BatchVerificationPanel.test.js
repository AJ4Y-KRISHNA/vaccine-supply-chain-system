import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BatchVerificationPanel from "../components/BatchVerificationPanel";
import { fetchBatchVerification } from "../services/blockchain";

jest.mock("../services/blockchain", () => {
  const actual = jest.requireActual("../services/blockchain");
  return { ...actual, fetchBatchVerification: jest.fn() };
});

beforeEach(() => jest.resetAllMocks());

test("healthcare user can enter a batch ID and see the blockchain verification result", async () => {
  fetchBatchVerification.mockResolvedValue({
    batchId: "DEMO-BATCH-01", vaccineType: "Demo Vaccine", quantity: "40", status: "Registered", verified: true,
  });
  render(<BatchVerificationPanel />);
  fireEvent.change(screen.getByLabelText("Batch ID or QR verification URL"), { target: { value: "DEMO-BATCH-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify batch" }));

  const result = await screen.findByRole("status", { name: "Batch verification result" });
  expect(fetchBatchVerification).toHaveBeenCalledWith("DEMO-BATCH-01", null);
  expect(result).toHaveTextContent("Batch verified on the local blockchain");
  expect(result).toHaveTextContent("Demo Vaccine");
  expect(result).toHaveTextContent("40");
});

test("a verification URL from the batch QR is parsed before the backend request", async () => {
  fetchBatchVerification.mockResolvedValue({ batchId: "DEMO-BATCH-02", verified: true, telemetryVerified: true,
    telemetryCount: 1, verifiedReading: { temperature: 5, digest: "0x" + "a".repeat(64), recordedAt: "2026-01-01T00:00:00Z" } });
  render(<BatchVerificationPanel />);
  fireEvent.change(screen.getByLabelText("Batch ID or QR verification URL"), {
    target: { value: `http://localhost:5000/api/batches/verify/DEMO-BATCH-02?recordId=${"0x" + "b".repeat(64)}&digest=${"0x" + "a".repeat(64)}&transactionHash=${"0x" + "c".repeat(64)}&chainId=31337&contractAddress=${"0x" + "1".repeat(40)}` },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify batch" }));
  await screen.findByRole("status", { name: "Batch verification result" });
  expect(fetchBatchVerification).toHaveBeenCalledWith("DEMO-BATCH-02", { recordId: "0x" + "b".repeat(64),
    digest: "0x" + "a".repeat(64), transactionHash: "0x" + "c".repeat(64), chainId: "31337", contractAddress: "0x" + "1".repeat(40) });
  expect(screen.getByRole("status", { name: "Batch verification result" })).toHaveTextContent("sensor record verified");
});

test("an incomplete QR proof is not downgraded to a successful batch-only check", async () => {
  render(<BatchVerificationPanel />);
  fireEvent.change(screen.getByLabelText("Batch ID or QR verification URL"), {
    target: { value: "http://localhost:5000/api/batches/verify/DEMO-BATCH-02?digest=broken" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify batch" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("incomplete or invalid local-chain proof");
  expect(fetchBatchVerification).not.toHaveBeenCalled();
});

test("failed blockchain verification is shown to the healthcare user", async () => {
  fetchBatchVerification.mockRejectedValue({ response: { status: 404, data: { message: "Batch not found on blockchain" } } });
  render(<BatchVerificationPanel />);
  fireEvent.change(screen.getByLabelText("Batch ID or QR verification URL"), { target: { value: "UNKNOWN-BATCH" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify batch" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Batch not found on blockchain");
});

test("unsupported automatic QR scanning presents the manual-entry fallback", () => {
  delete window.BarcodeDetector;
  render(<BatchVerificationPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Start camera scan" }));
  expect(screen.getByRole("status")).toHaveTextContent("Automatic QR scanning is not supported");
});
