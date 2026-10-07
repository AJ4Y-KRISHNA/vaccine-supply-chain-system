import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import BatchVerificationPanel from "../components/BatchVerificationPanel";
import BatchVerificationQr from "../components/BatchVerificationQr";
import { batchVerificationUrl, parseBatchVerificationCode, fetchBatchVerification, fetchBatchVerificationPayload } from "../services/blockchain";
jest.mock("../services/blockchain", () => ({ ...jest.requireActual("../services/blockchain"), fetchBatchVerification: jest.fn(), fetchBatchVerificationPayload: jest.fn() }));
beforeEach(() => jest.clearAllMocks());
test.each(["yes", "pending", "no"])("verification page distinguishes batch identity from sensor evidence: %s", async state => {
  fetchBatchVerification.mockResolvedValue({ verified: true, batchId: "SYNTHETIC-B", sensorEvidenceAnchored: state,
    historySummary: { count: state === "no" ? 0 : 3, minimum: 5, maximum: 6, mean: 5.5 }, evidence: [], distributionRecords: [] });
  render(<BatchVerificationPanel initialCode="SYNTHETIC-B" />);
  expect(await screen.findByText(`Sensor evidence anchored: ${state}`)).toBeInTheDocument();
  expect(screen.getByText("Batch verified on the local blockchain")).toBeInTheDocument();
});
test("tampered history is a visible failure, not a green sensor verification", async () => {
  fetchBatchVerification.mockResolvedValue({ verified: true, batchId: "SYNTHETIC-B", sensorEvidenceAnchored: "no", integrityFailure: true });
  render(<BatchVerificationPanel initialCode="SYNTHETIC-B" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Sensor verification failed");
});
test.each(["yes", "no"])("manufacturer QR encodes a navigable verification page with %s evidence", async state => {
  fetchBatchVerificationPayload.mockResolvedValue({ verified: true, batchId: "SYNTHETIC-B", sensorEvidenceAnchored: state });
  render(<BatchVerificationQr batchId="SYNTHETIC-B" />);
  fireEvent.click(screen.getByText("Show batch QR"));
  expect(await screen.findByLabelText("Verification QR code for batch SYNTHETIC-B")).toBeInTheDocument();
  expect(screen.getByText(batchVerificationUrl("SYNTHETIC-B"))).toBeInTheDocument();
  expect(parseBatchVerificationCode(batchVerificationUrl("SYNTHETIC-B"))).toEqual({ batchId: "SYNTHETIC-B", proof: null, proofInvalid: false });
});
