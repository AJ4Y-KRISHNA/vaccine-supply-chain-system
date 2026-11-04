import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SensorHistoryCharts, { chartDomain, eventMarkers, pointColor } from "./SensorHistoryCharts.jsx";

vi.mock("recharts", () => ({
  CartesianGrid: () => null,
  Line: ({ dataKey }) => <span data-testid="line" data-key={dataKey} />,
  LineChart: ({ children, data }) => (
    <div data-testid="line-chart" data-samples={data.length}>
      {children}
    </div>
  ),
  ReferenceLine: ({ y, x, label }) => (
    <span data-testid={x === undefined ? "policy-line" : "event-line"} data-value={y ?? x}>
      {label.value}
    </span>
  ),
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: ({ domain }) => <span data-testid="y-axis" data-domain={JSON.stringify(domain)} />,
}));

afterEach(cleanup);

describe("SensorHistoryCharts", () => {
  it("plots both metrics and renders supplied policy boundaries for the sample history", () => {
    render(
      <SensorHistoryCharts
        history={[
          {
            temperature: 5,
            humidity: 48,
            simulationClock: "2026-01-01T00:00:00Z",
            status: "normal",
          },
          {
            temperature: 9,
            humidity: 72,
            simulationClock: "2026-01-01T00:01:00Z",
            status: "warning",
          },
        ]}
        policy={{
          minimumTemperature: 2,
          maximumTemperature: 8,
          minimumHumidity: 30,
          maximumHumidity: 70,
        }}
      />,
    );

    expect(screen.getAllByTestId("line-chart")).toHaveLength(2);
    expect(screen.getAllByTestId("line-chart")[0]).toHaveAttribute("data-samples", "2");
    expect(screen.getAllByTestId("policy-line")).toHaveLength(4);
    expect(JSON.parse(screen.getAllByTestId("y-axis")[0].getAttribute("data-domain"))).toEqual([
      1.3, 9.7,
    ]);
    expect(screen.getByText(/Configured policy range: 2–8 °C/)).toBeInTheDocument();
    expect(screen.getByText(/Configured policy range: 30–70 % RH/)).toBeInTheDocument();
  });

  it("shows explicit empty and unconfigured-policy states", () => {
    render(<SensorHistoryCharts history={[]} latestReading={null} policy={{}} />);
    expect(screen.getByText("No temperature history samples received yet.")).toBeInTheDocument();
    expect(screen.getByText("No humidity history samples received yet.")).toBeInTheDocument();
    expect(screen.getAllByText(/no safe band is inferred/)).toHaveLength(2);
  });

  it("renders more than 30 persisted readings without truncating chart input", () => {
    const history = Array.from({ length: 42 }, (_, index) => ({
      temperature: 4 + index / 20,
      humidity: 45 + index / 2,
      simulationClock: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));
    render(<SensorHistoryCharts history={history} policy={{ minimumTemperature: 2, maximumTemperature: 8 }} />);
    expect(screen.getAllByTestId("line-chart").map((chart) => chart.getAttribute("data-samples"))).toEqual(["42", "42"]);
    expect(screen.getByText(/Charts include all saved readings/)).toBeInTheDocument();
  });

  it("colors points from status and approved ranges without inferring safety when policy is absent", () => {
    expect(pointColor({ temperature: 5 }, "temperature", 2, 8)).toBe("var(--color-primary)");
    expect(pointColor({ temperature: 9 }, "temperature", 2, 8)).toBe("var(--color-warning)");
    expect(pointColor({ temperature: 5, status: "review_required" }, "temperature", 2, 8)).toBe(
      "var(--color-warning)",
    );
    expect(pointColor({ temperature: 5 }, "temperature", null, null)).toBe(
      "var(--color-text-secondary)",
    );
    expect(chartDomain([{ value: 5 }], 2, 8)).toEqual([1.4, 8.6]);
  });

  it("marks persisted alert, quarantine, and recovery events against the nearest plotted sample", () => {
    const history = [
      { temperature: 5, humidity: 50, simulationClock: "2026-01-01T00:00:00Z" },
      { temperature: 10, humidity: 52, simulationClock: "2026-01-01T00:01:00Z" },
      { temperature: 6, humidity: 51, simulationClock: "2026-01-01T00:02:00Z" },
    ];
    const alerts = [{ alertId: "ALERT-1", phase: "CLEARED", requiresQualityReview: true,
      simulationClock: "2026-01-01T00:01:00Z", excursionStartedAt: "2026-01-01T00:00:00Z",
      excursionClosedAt: "2026-01-01T00:02:00Z" }];
    const markers = eventMarkers(history, alerts);

    expect(markers.map((marker) => marker.label)).toEqual(["Alert opened", "Quarantine", "Recovered"]);
    expect(markers.map((marker) => marker.x)).toEqual(history.map((reading) => new Date(reading.simulationClock)
      .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })));

    render(<SensorHistoryCharts history={history} alerts={alerts} policy={{ minimumTemperature: 2,
      maximumTemperature: 8, minimumHumidity: 40, maximumHumidity: 80 }} />);
    expect(screen.getAllByTestId("event-line")).toHaveLength(6);
  });
});
