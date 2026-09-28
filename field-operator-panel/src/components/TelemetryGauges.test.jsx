import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TelemetryGauges from "./TelemetryGauges.jsx";

vi.mock("react-gauge-component", () => ({
  default: ({ value, minValue, maxValue }) => (
    <div
      data-testid="temperature-humidity-gauge"
      data-value={value}
      data-min={minValue}
      data-max={maxValue}
    />
  ),
}));

afterEach(cleanup);

describe("TelemetryGauges", () => {
  it("shows readings, approved ranges, and range status from the supplied values", () => {
    render(
      <TelemetryGauges
        telemetry={{ temperature: 5.2, humidity: 56, battery: 94.5 }}
        policy={{
          minimumTemperature: 2,
          maximumTemperature: 8,
          minimumHumidity: 30,
          maximumHumidity: 70,
          criticalBatteryPercent: 15,
        }}
      />,
    );

    expect(screen.getByText(/5.2/)).toBeInTheDocument();
    expect(screen.getByText(/56.0/)).toBeInTheDocument();
    expect(screen.getAllByText("Within approved range")).toHaveLength(2);
    expect(screen.getByText("Approved range: 2–8 °C")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Battery level" })).toHaveAttribute(
      "aria-valuenow",
      "94.5",
    );
  });

  it("does not invent readings or approved ranges when source data is missing", () => {
    render(<TelemetryGauges telemetry={null} policy={null} />);
    expect(screen.getAllByText("No sensor sample received")).toHaveLength(3);
    expect(screen.getAllByText("Approved range: Not provided")).toHaveLength(2);
    expect(screen.getByText("Critical threshold: Not provided")).toBeInTheDocument();
  });
});
