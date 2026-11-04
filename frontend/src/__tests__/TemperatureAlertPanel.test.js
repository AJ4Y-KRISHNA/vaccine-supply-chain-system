import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("../services/alerts", () => ({
  acknowledgeTemperatureAlert: jest.fn(),
  fetchTemperatureAlertSummary: jest.fn(),
  fetchTemperatureAlerts: jest.fn(),
  fetchTemperatureNotifications: jest.fn(),
  markTemperatureNotificationRead: jest.fn(),
  actOnColdChainAlert: jest.fn(),
  fetchColdChainAlert: jest.fn(),
  approveColdChainPolicy: jest.fn(),
  fetchColdChainPolicy: jest.fn(),
  checkColdChainTelemetry: jest.fn(),
}));
jest.mock("../components/Toast", () => ({
  useToast: () => ({ addToast: jest.fn() }),
}));

const TemperatureAlertPanel = require("../components/TemperatureAlertPanel").default;
const {
  acknowledgeTemperatureAlert,
  fetchTemperatureAlertSummary,
  fetchTemperatureAlerts,
  fetchTemperatureNotifications,
  markTemperatureNotificationRead,
  actOnColdChainAlert,
  fetchColdChainAlert,
} = require("../services/alerts");

const alert = {
  alertId: "TEMP-001",
  batchId: "VAC-001",
  shipmentId: "SHIP-001",
  deviceId: "IOT-001",
  vehicleId: "TRUCK-01",
  currentTemperature: 10,
  minimumAllowedTemperature: 2,
  maximumAllowedTemperature: 8,
  minimumExcursionTemperature: 9,
  maximumExcursionTemperature: 10,
  violationType: "HIGH_TEMPERATURE",
  severity: "WARNING",
  status: "ACTIVE",
  responseState: "OPEN",
  reason: "Temperature exceeded the configured maximum limit by 2°C.",
  latitude: 9.9312,
  longitude: 76.2673,
  timestamp: "2026-09-17T10:30:00.000Z",
  excursionStartedAt: "2026-09-17T10:30:00.000Z",
};

function arrange({ alerts = [alert], notifications = [{ _id: "note-1", title: "Application Notification", message: "Test", read: false }], summary = {} } = {}) {
  fetchTemperatureAlertSummary.mockResolvedValue({ active: 1, critical: 0, warning: 1, resolved: 0, permissions: { canManage: true, canReview: true }, ...summary });
  fetchTemperatureAlerts.mockResolvedValue({ alerts, total: alerts.length });
  fetchTemperatureNotifications.mockResolvedValue({ notifications });
  acknowledgeTemperatureAlert.mockResolvedValue({ alert: { ...alert, status: "ACKNOWLEDGED" } });
  actOnColdChainAlert.mockResolvedValue({ alert: { ...alert, status: "RESOLVED" } });
  fetchColdChainAlert.mockResolvedValue({ alert, evidenceAsOf: "2026-01-01T00:03:00.000Z", auditTrail: [{ _id: "audit-1", action: "QUARANTINE", reason: "Approved policy exceeded" }] });
  markTemperatureNotificationRead.mockResolvedValue({ notification: { _id: "note-1", read: true } });
}

describe("TemperatureAlertPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    arrange();
  });

  test("displays alert counts, alert history, and application notifications", async () => {
    render(<TemperatureAlertPanel role="admin" />);

    expect(await screen.findByText("Temperature Alert Monitoring")).toBeInTheDocument();
    expect(screen.getByText("Active alerts")).toBeInTheDocument();
    expect(await screen.findByText("VAC-001")).toBeInTheDocument();
    expect(screen.getByText("Application Notification")).toBeInTheDocument();
  });

  test("shows full alert details on selection", async () => {
    render(<TemperatureAlertPanel role="admin" />);
    await screen.findByText("VAC-001");

    fireEvent.click(screen.getByText("VAC-001"));
    expect(await screen.findByText("Current temperature:")).toBeInTheDocument();
    expect(screen.getByText("Simulated location:")).toBeInTheDocument();
  });

  test("applies admin filtering parameters", async () => {
    render(<TemperatureAlertPanel role="admin" />);
    await screen.findByText("VAC-001");

    fireEvent.change(screen.getByLabelText("Alert severity filter"), { target: { value: "CRITICAL" } });
    fireEvent.change(screen.getByLabelText("Batch filter"), { target: { value: "VAC-001" } });
    fireEvent.click(screen.getByText("Apply"));

    await waitFor(() => expect(fetchTemperatureAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ severity: "CRITICAL", batchId: "VAC-001" })));
  });

  test("acknowledges an active alert for an administrator", async () => {
    render(<TemperatureAlertPanel role="admin" />);
    fireEvent.click(await screen.findByText("Acknowledge"));
    fireEvent.change(await screen.findByLabelText("Action reason"), { target: { value: "Operations accepted responsibility" } });
    fireEvent.click(screen.getByText("Confirm acknowledge"));

    await waitFor(() => expect(acknowledgeTemperatureAlert).toHaveBeenCalledWith("TEMP-001", { reason: "Operations accepted responsibility" }));
  });

  test("records one of the allowed operator response actions with an audit note", async () => {
    arrange({ alerts: [{ ...alert, responseState: "ACKNOWLEDGED", status: "ACKNOWLEDGED" }] });
    render(<TemperatureAlertPanel role="manufacturer" />);
    fireEvent.click(await screen.findByText("Record action taken"));
    fireEvent.change(await screen.findByLabelText("Response action"), { target: { value: "reroute" } });
    fireEvent.change(screen.getByLabelText("Action reason"), { target: { value: "Rerouted to the approved alternate route" } });
    fireEvent.click(screen.getByText("Confirm action-taken"));
    await waitFor(() => expect(actOnColdChainAlert).toHaveBeenCalledWith("TEMP-001", "action-taken", { action: "reroute", reason: "Rerouted to the approved alternate route" }));
  });

  test("clearance requires explicit review reason and simulation-clock evidence", async () => {
    arrange({ alerts: [{ ...alert, responseState: "ACTION_TAKEN", excursionClosedAt: "2026-01-01T00:02:00.000Z", reviewedBy: "reviewer-1" }] });
    render(<TemperatureAlertPanel role="admin" />);
    fireEvent.click(await screen.findByText("Clear after review"));
    fireEvent.change(await screen.findByLabelText("Action reason"), { target: { value: "Quality review completed" } });
    expect(actOnColdChainAlert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm clear"));
    await waitFor(() => expect(actOnColdChainAlert).toHaveBeenCalledWith("TEMP-001", "clear", { reason: "Quality review completed", asOf: "2026-01-01T00:03:00.000Z" }));
  });

  test("shows the server-computed simulated escalation flag", async () => {
    arrange({ alerts: [{ ...alert, escalated: true, responseState: "OPEN" }] });
    render(<TemperatureAlertPanel role="admin" />);
    expect(await screen.findByText("Escalated")).toBeInTheDocument();
  });

  test("manufacturer may acknowledge but needs a designated capability for quality clearance", async () => {
    arrange({ summary: { permissions: { canManage: true, canReview: false } } });
    render(<TemperatureAlertPanel role="manufacturer" />);
    await screen.findByText("VAC-001");

    expect(screen.queryByText("Acknowledge")).toBeInTheDocument();
    expect(screen.queryByText("Record action taken")).not.toBeInTheDocument();
    expect(screen.queryByText("Clear after review")).not.toBeInTheDocument();
    expect(screen.queryByText("Approve new policy revision")).not.toBeInTheDocument();
  });

  test("downstream recipients have a read-only queue", async () => {
    arrange({ summary: { permissions: { canManage: false, canReview: false } } });
    render(<TemperatureAlertPanel role="healthcare" />);
    await screen.findByText("VAC-001");
    expect(screen.queryByText("Quarantine")).not.toBeInTheDocument();
    expect(screen.queryByText("Clear after review")).not.toBeInTheDocument();
  });

  test("shows a loading state before requests finish", () => {
    fetchTemperatureAlertSummary.mockReturnValue(new Promise(() => {}));
    fetchTemperatureAlerts.mockReturnValue(new Promise(() => {}));
    fetchTemperatureNotifications.mockReturnValue(new Promise(() => {}));

    render(<TemperatureAlertPanel role="admin" />);
    expect(screen.getByText("Loading temperature alerts…")).toBeInTheDocument();
  });

  test("shows an API error state", async () => {
    fetchTemperatureAlertSummary.mockRejectedValue({ response: { status: 503, data: { error: "Server unavailable" } } });
    render(<TemperatureAlertPanel role="admin" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");
  });

  test("marks an unread application notification as read", async () => {
    render(<TemperatureAlertPanel role="admin" />);
    fireEvent.click(await screen.findByText("Application Notification"));

    await waitFor(() => expect(markTemperatureNotificationRead).toHaveBeenCalledWith("note-1"));
  });

  test("rejects a reversed date range and clears filters", async () => {
    render(<TemperatureAlertPanel role="admin" />);
    await screen.findByText("VAC-001");
    fireEvent.change(screen.getByLabelText("From date filter"), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByLabelText("To date filter"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(screen.getByRole("alert")).toHaveTextContent("From date must be on or before");
    expect(fetchTemperatureAlerts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Clear filters"));
    expect(screen.getByLabelText("From date filter")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("prevents a second acknowledgment while the first request is pending", async () => {
    acknowledgeTemperatureAlert.mockReturnValue(new Promise(() => {}));
    render(<TemperatureAlertPanel role="admin" />);
    fireEvent.click(await screen.findByText("Acknowledge"));
    fireEvent.change(await screen.findByLabelText("Action reason"), { target: { value: "Operations accepted responsibility" } });
    const button = screen.getByText("Confirm acknowledge");
    fireEvent.click(button); fireEvent.click(button);
    expect(acknowledgeTemperatureAlert).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Confirm acknowledge")).toBeDisabled();
  });

  test("does not send invalid evidence and allows cancellation without a mutation", async () => {
    arrange({ alerts: [{ ...alert, responseState: "ACTION_TAKEN", excursionClosedAt: "2026-01-01T00:02:00.000Z", reviewedBy: "reviewer-1" }] });
    render(<TemperatureAlertPanel role="admin" />);
    fireEvent.click(await screen.findByText("Clear after review"));
    fireEvent.change(await screen.findByLabelText("Action reason"), { target: { value: "Test review reason" } });
    fireEvent.change(screen.getByLabelText("Evidence simulation clock"), { target: { value: "invalid" } });
    fireEvent.click(screen.getByText("Confirm clear"));
    expect(actOnColdChainAlert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel action"));
    expect(screen.queryByLabelText("Action reason")).not.toBeInTheDocument();
  });

  test("late audit history from another selection cannot replace current alert evidence", async () => {
    arrange({ alerts: [alert, { ...alert, alertId: "TEMP-002", batchId: "VAC-002" }] });
    let completeFirst;
    fetchColdChainAlert.mockImplementation(id => id === "TEMP-001" ? new Promise(resolve => { completeFirst = resolve; }) : Promise.resolve({ auditTrail: [{ _id: "second", action: "SECOND HISTORY", reason: "Second batch only" }] }));
    render(<TemperatureAlertPanel role="admin" />);
    fireEvent.click(await screen.findByText("VAC-001"));
    fireEvent.click(screen.getByText("VAC-002"));
    await screen.findByText(/SECOND HISTORY/);
    await act(async () => completeFirst({ auditTrail: [{ _id: "first", action: "WRONG HISTORY", reason: "First batch" }] }));
    expect(screen.queryByText(/WRONG HISTORY/)).not.toBeInTheDocument();
    expect(screen.getByText(/SECOND HISTORY/)).toBeInTheDocument();
  });
});
