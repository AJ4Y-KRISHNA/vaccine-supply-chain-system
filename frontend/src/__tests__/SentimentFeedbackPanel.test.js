import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SentimentFeedbackPanel from "../components/Admin/SentimentFeedbackPanel";
import { fetchAdminFeedback } from "../services/feedback";
const mockToast = jest.fn();
jest.mock("../components/Toast", () => ({ useToast: () => ({ addToast: mockToast }) }));
jest.mock("../services/feedback", () => ({ fetchAdminFeedback: jest.fn() }));
beforeEach(() => { jest.resetAllMocks(); });

test("initial failure is visible, refresh retries, and batch inspection calls the real parent action", async () => {
  fetchAdminFeedback.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ summary: { totalFeedbackCount: 1 }, recentFeedback: [{ _id: "F1", vaccineBatchId: "B1", patientFeedbackText: "Demo feedback", sentimentLabel: "Neutral" }] });
  const focus = jest.fn();
  render(<SentimentFeedbackPanel onFocusBatch={focus} selectedAuditBatchId="" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Feedback analytics unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  fireEvent.click(await screen.findByRole("button", { name: /Demo feedback/ }));
  expect(focus).toHaveBeenCalledWith("B1");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("disables overlapping refreshes while a request is pending", async () => {
  let resolve;
  fetchAdminFeedback.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<SentimentFeedbackPanel />);
  expect(screen.getByRole("button", { name: "Refresh" })).toBeDisabled();
  resolve({ summary: {} });
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());
  expect(fetchAdminFeedback).toHaveBeenCalledTimes(1);
});
