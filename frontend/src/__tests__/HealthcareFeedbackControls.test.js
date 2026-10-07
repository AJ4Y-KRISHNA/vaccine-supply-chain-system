import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FeedbackForm from "../components/Healthcare/FeedbackForm";
import { fetchHealthcareFeedback, submitHealthcareFeedback } from "../services/feedback";
jest.mock("../services/feedback", () => ({ fetchHealthcareFeedback: jest.fn(), submitHealthcareFeedback: jest.fn() }));
jest.mock("../components/Toast", () => ({ useToast: () => ({ addToast: mockToast }) }));
const mockToast = jest.fn();
const openForm = async () => {
  render(<FeedbackForm healthcareCenter="Demo Hospital" submittedBy="hospital@example.test" batchSuggestions={["DEMO-BATCH"]} />);
  await waitFor(() => expect(fetchHealthcareFeedback).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Add Feedback" }));
};
beforeEach(() => { jest.clearAllMocks(); fetchHealthcareFeedback.mockResolvedValue({ records: [] }); });

test("failed history is visible and refresh retries the request", async () => {
  fetchHealthcareFeedback.mockRejectedValueOnce(new Error("Synthetic failure"));
  await openForm();
  await screen.findByText(/Feedback history could not be loaded/);
  fireEvent.click(screen.getByRole("button", { name: "Refresh feedback" }));
  await waitFor(() => expect(screen.queryByText(/Feedback history could not be loaded/)).not.toBeInTheDocument());
  expect(fetchHealthcareFeedback).toHaveBeenCalledTimes(2);
});

test("feedback validates required text and observation date before sending", async () => {
  await openForm();
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  expect(submitHealthcareFeedback).not.toHaveBeenCalled();
  expect(screen.getByText("Feedback text is required.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Patient feedback text"), { target: { value: "Synthetic demonstration feedback" } });
  fireEvent.change(screen.getByLabelText("Observation date"), { target: { value: "2099-01-01T12:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  expect(screen.getByText("Observation date cannot be in the future.")).toBeInTheDocument();
  expect(submitHealthcareFeedback).not.toHaveBeenCalled();
});

test("submission is single-flight, keeps identity read-only, and defaults analytics consent off", async () => {
  let finish;
  submitHealthcareFeedback.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await openForm();
  expect(screen.getByLabelText("Submitted by")).toHaveAttribute("readonly");
  expect(screen.getByLabelText("Consent to use for analytics")).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Patient feedback text"), { target: { value: "  Synthetic demonstration feedback  " } });
  fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
  fireEvent.click(screen.getByRole("button", { name: "Submitting..." }));
  expect(submitHealthcareFeedback).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  expect(submitHealthcareFeedback.mock.calls[0][0]).toMatchObject({ patientFeedbackText: "Synthetic demonstration feedback", vaccineBatchId: "DEMO-BATCH", consentToUseForAnalytics: false });
  await act(async () => finish({ sentimentLabel: "Neutral", sentimentScore: 0.5 }));
  await screen.findByRole("status");
});
