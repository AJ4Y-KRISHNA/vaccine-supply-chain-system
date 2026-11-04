import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AlertFeed, { CriticalAlertBanner, getUnreadAlertCount } from "./AlertFeed.jsx";

afterEach(cleanup);

const criticalAlert = {
  alertId: "ALERT-1",
  shipmentId: "SHIP-1",
  severity: "critical",
  metric: "temperature",
  value: 10.8,
  limit: 8,
  duration: 18,
  message: "Temperature exceeded the approved maximum for 18 minutes.",
  simulationClock: "2026-01-01T00:18:00.000Z",
  read: false,
  acknowledged: false,
};

describe("AlertFeed", () => {
  it("renders a critical banner, alert details, and a main-system shipment deep link", () => {
    render(
      <>
        <CriticalAlertBanner alert={criticalAlert} />
        <AlertFeed alerts={[criticalAlert]} shipmentId="SHIP-1" onAcknowledge={vi.fn()} />
      </>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Unacknowledged critical event");
    expect(screen.getAllByText(criticalAlert.message)).toHaveLength(2);
    expect(screen.getByText(/temperature: 10.8 · limit 8 · 18 min/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View shipment in main system/ })).toHaveAttribute(
      "href",
      "http://localhost:3000/live-shipments?shipmentId=SHIP-1",
    );
    expect(screen.getByText(/lost on reload or shipment change/)).toBeInTheDocument();
  });

  it("acknowledges locally and does not call it resolved", () => {
    const onAcknowledge = vi.fn();
    render(
      <AlertFeed alerts={[criticalAlert]} shipmentId="SHIP-1" onAcknowledge={onAcknowledge} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Acknowledge locally" }));
    expect(onAcknowledge).toHaveBeenCalledWith("ALERT-1");
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
  });

  it("counts unread events and keeps unknown/no-data state explicit", () => {
    expect(getUnreadAlertCount([criticalAlert, { ...criticalAlert, read: true }])).toBe(1);
    render(<AlertFeed alerts={[]} shipmentId="" onAcknowledge={vi.fn()} />);
    expect(screen.getByText("No alert events received")).toBeInTheDocument();
    expect(screen.getByText(/does not mean that the shipment is within/)).toBeInTheDocument();
  });

  it("does not show a resolved critical event as an active banner or unread item", () => {
    const recovered = { ...criticalAlert, status: "RESOLVED" };
    const { container } = render(
      <>
        <CriticalAlertBanner alert={recovered} />
        <AlertFeed alerts={[recovered]} shipmentId="SHIP-1" onAcknowledge={vi.fn()} />
      </>,
    );

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(screen.getByText("Unacknowledged: 0")).toBeInTheDocument();
    expect(getUnreadAlertCount([recovered])).toBe(0);
  });
});
