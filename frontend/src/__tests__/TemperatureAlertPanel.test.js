import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

    await waitFor(() => expect(acknowledgeTemperatureAlert).toHaveBeenCalledWith("TEMP-001"));
  });

  test("clearance requires explicit review reason and simulation-clock evidence", async () => {
    render(<TemperatureAlertPanel role="admin" />);
    fireEvent.click(await screen.findByText("Clear after review"));
    fireEvent.change(await screen.findByLabelText("Action reason"), { target: { value: "Quality review completed" } });
    expect(actOnColdChainAlert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm clear"));
    await waitFor(() => expect(actOnColdChainAlert).toHaveBeenCalledWith("TEMP-001", "clear", { reason: "Quality review completed", asOf: "2026-01-01T00:03:00.000Z" }));
  });

  test("manufacturer may acknowledge but needs a designated capability for quality clearance", async () => {
    arrange({ summary: { permissions: { canManage: true, canReview: false } } });
    render(<TemperatureAlertPanel role="manufacturer" />);
    await screen.findByText("VAC-001");

    expect(screen.queryByText("Acknowledge")).toBeInTheDocument();
    expect(screen.queryByText("Quarantine")).toBeInTheDocument();
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
});
