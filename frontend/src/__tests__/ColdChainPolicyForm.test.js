import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ColdChainPolicyForm from "../components/ColdChainPolicyForm";
import { approveColdChainPolicy, checkColdChainTelemetry, fetchColdChainPolicy } from "../services/alerts";
jest.mock("../services/alerts", () => ({ approveColdChainPolicy: jest.fn(), checkColdChainTelemetry: jest.fn(), fetchColdChainPolicy: jest.fn() }));
beforeEach(() => jest.clearAllMocks());

test("policy form starts without medical defaults and submits only explicit reviewer inputs", async () => {
  approveColdChainPolicy.mockResolvedValue({ policy: { _id: "revision-1" } });
  const changed = jest.fn();
  render(<ColdChainPolicyForm canReview onChange={changed} />);
  expect(screen.getByLabelText("Minimum temperature (°C)")).toHaveValue(null);
  fireEvent.change(screen.getByLabelText("Policy batch ID"), { target: { value: "BATCH-1" } });
  const values = [["Minimum temperature (°C)", "2"], ["Maximum temperature (°C)", "8"], ["Sustained excursion duration (milliseconds)", "120000"], ["Maximum reading gap (milliseconds)", "90000"], ["Critical battery (%)", "10"], ["Maximum plausible change (°C/minute)", "100"], ["Approved policy source/reference", "Synthetic test fixture"], ["Policy approval reason", "Workflow test only"]];
  for (const [label, value] of values) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByText("Approve new policy revision"));
  await waitFor(() => expect(approveColdChainPolicy).toHaveBeenCalledWith("BATCH-1", {
    minimumTemperature: 2, maximumTemperature: 8, excursionDurationMs: 120000, maximumReadingGapMs: 90000,
    criticalBatteryPercent: 10, maximumRateCelsiusPerMinute: 100, sourceReference: "Synthetic test fixture", approvalReason: "Workflow test only",
  }));
  expect(changed).toHaveBeenCalledTimes(1);
});

test("reviewer can configure a paired humidity range and existing revisions explain skipped checks", async () => {
  approveColdChainPolicy.mockResolvedValue({ policy: { _id: "revision-humidity" } });
  fetchColdChainPolicy.mockResolvedValue({ policy: { _id: "legacy-revision", minimumTemperature: 2, maximumTemperature: 8, excursionDurationMs: 120000, sourceReference: "Synthetic fixture" }, policyStatus: "APPROVED" });
  render(<ColdChainPolicyForm canReview onChange={jest.fn()} />);
  expect(screen.getByText(/leave both blank to skip them/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Policy batch ID"), { target: { value: "BATCH-HUMIDITY" } });
  fireEvent.click(screen.getByText("Inspect policy"));
  expect(await screen.findByText(/humidity not configured \(checks skipped\)/i)).toBeInTheDocument();
  const values = [["Minimum temperature (°C)", "2"], ["Maximum temperature (°C)", "8"],
    ["Minimum humidity (%) — optional", "40"], ["Maximum humidity (%) — optional", "80"],
    ["Sustained excursion duration (milliseconds)", "120000"], ["Maximum reading gap (milliseconds)", "90000"],
    ["Critical battery (%)", "10"], ["Maximum plausible change (°C/minute)", "100"],
    ["Approved policy source/reference", "Synthetic fixture"], ["Policy approval reason", "Test only"]];
  for (const [label, value] of values) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByText("Approve new policy revision"));
  await waitFor(() => expect(approveColdChainPolicy).toHaveBeenCalledWith("BATCH-HUMIDITY", expect.objectContaining({ minimumHumidity: 40, maximumHumidity: 80 })));
});

test("non-reviewers can inspect policy and check silence, but cannot approve", async () => {
  fetchColdChainPolicy.mockResolvedValue({ policy: null, policyStatus: "POLICY_NOT_APPROVED" });
  checkColdChainTelemetry.mockResolvedValue({ alerts: [{}] });
  render(<ColdChainPolicyForm canReview={false} onChange={jest.fn()} />);
  expect(screen.queryByText("Approve new policy revision")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Policy batch ID"), { target: { value: "BATCH-1" } });
  fireEvent.click(screen.getByText("Inspect policy"));
  await screen.findByText("POLICY_NOT_APPROVED");
  fireEvent.change(screen.getByLabelText("Current simulation clock (ISO timestamp)"), { target: { value: "2026-01-01T00:05:00.000Z" } });
  fireEvent.click(screen.getByText("Check missing telemetry"));
  await waitFor(() => expect(checkColdChainTelemetry).toHaveBeenCalledWith("BATCH-1", "2026-01-01T00:05:00.000Z"));
});

test("changing batches clears policy draft and clock so another batch cannot inherit an approval", () => {
  render(<ColdChainPolicyForm canReview onChange={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Policy batch ID"), { target: { value: "B1" } });
  fireEvent.change(screen.getByLabelText("Minimum temperature (°C)"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Current simulation clock (ISO timestamp)"), { target: { value: "2026-01-01T00:05:00.000Z" } });
  fireEvent.change(screen.getByLabelText("Policy batch ID"), { target: { value: "B2" } });
  expect(screen.getByLabelText("Minimum temperature (°C)")).toHaveValue(null);
  expect(screen.getByLabelText("Current simulation clock (ISO timestamp)")).toHaveValue("");
  expect(approveColdChainPolicy).not.toHaveBeenCalled();
});

test("invalid clock does not call the missing-telemetry mutation", async () => {
  render(<ColdChainPolicyForm canReview={false} />);
  fireEvent.change(screen.getByLabelText("Policy batch ID"), { target: { value: "B1" } });
  fireEvent.change(screen.getByLabelText("Current simulation clock (ISO timestamp)"), { target: { value: "invalid" } });
  fireEvent.click(screen.getByText("Check missing telemetry"));
  expect(await screen.findByRole("status")).toHaveTextContent("valid ISO simulation timestamp");
  expect(checkColdChainTelemetry).not.toHaveBeenCalled();
});
