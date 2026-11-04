import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BatchVerificationQr from "../components/BatchVerificationQr";
import { batchIdFromVerificationCode, batchVerificationUrl, fetchBatchVerificationPayload } from "../services/blockchain";

jest.mock("../services/blockchain", () => {
  const actual = jest.requireActual("../services/blockchain");
  return { ...actual, fetchBatchVerificationPayload: jest.fn() };
});

beforeEach(() => jest.clearAllMocks());

test("manufacturer QR obtains and encodes the latest on-chain temperature record digest", async () => {
  const digest = "0x" + "a".repeat(64), recordId = "0x" + "b".repeat(64), transactionHash = "0x" + "c".repeat(64);
  fetchBatchVerificationPayload.mockResolvedValue({ batchId: "DEMO-BATCH-01", chainId: 31337,
    contractAddress: "0x" + "1".repeat(40), telemetryCount: 1,
    latestReading: { recordId, digest, transactionHash, temperature: 5.25, recordedAt: "2026-01-01T00:00:00Z" } });
  render(<BatchVerificationQr batchId="DEMO-BATCH-01" />);
  fireEvent.click(screen.getByText("Show batch QR"));
  const qr = await screen.findByLabelText("Verification QR code for batch DEMO-BATCH-01");
  expect(qr.tagName.toLowerCase()).toBe("svg");
  expect(screen.getByText(new RegExp(`/batches/verify/DEMO-BATCH-01.*${digest}`))).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`Sensor record ${recordId}`))).toBeInTheDocument();
  expect(screen.getByText(new RegExp(`Transaction: ${transactionHash}`))).toBeInTheDocument();
  expect(fetchBatchVerificationPayload).toHaveBeenCalledWith("DEMO-BATCH-01");
});

test("a QR link and a manual batch ID resolve to a batch ID without trusting its host", () => {
  expect(batchIdFromVerificationCode("http://localhost:5000/api/batches/verify/DEMO-BATCH-01"))
    .toBe("DEMO-BATCH-01");
  expect(batchIdFromVerificationCode("DEMO-BATCH-01")).toBe("DEMO-BATCH-01");
  expect(batchIdFromVerificationCode("https://example.test/not-a-batch" )).toBe("");
  expect(batchVerificationUrl("DEMO/BATCH 01")).toContain("DEMO%2FBATCH%2001");
  const proofUrl = batchVerificationUrl("DEMO-BATCH-01", { chainId: 31337, contractAddress: "0x" + "1".repeat(40),
    latestReading: { recordId: "0x" + "b".repeat(64), digest: "0x" + "a".repeat(64) } });
  expect(proofUrl).not.toContain("recordId=");
  expect(proofUrl).not.toContain("digest=");
  expect(proofUrl).not.toContain("transactionHash=");
  const verifiedUrl = batchVerificationUrl("DEMO-BATCH-01", { chainId: 31337, contractAddress: "0x" + "1".repeat(40),
    latestReading: { recordId: "0x" + "b".repeat(64), digest: "0x" + "a".repeat(64), transactionHash: "0x" + "c".repeat(64) } });
  expect(verifiedUrl).toContain("transactionHash=0x");
});

test("QR control is absent when there is no batch identifier", () => {
  const { container } = render(<BatchVerificationQr batchId="" />);
  expect(container).toBeEmptyDOMElement();
});
