import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManualOverrideConsole from "./ManualOverrideConsole.jsx";
import { useFieldOperatorStore } from "../stores/fieldOperatorStore.js";

const policy = {
  minimumTemperature: 2,
  maximumTemperature: 8,
  minimumHumidity: 30,
  maximumHumidity: 70,
};

function renderConsole(overrides = {}) {
  const sendCommand = vi.fn(() => ({ ok: true }));
  render(
    <ManualOverrideConsole
      shipmentId="SHIP-1"
      policy={policy}
      telemetry={{ temperature: 5, humidity: 50 }}
      activeOverride={null}
      simulationClock="2026-01-01T00:00:00.000Z"
      connectionStatus="connected"
      sendCommand={sendCommand}
      {...overrides}
    />,
  );
  return sendCommand;
}

beforeEach(() => {
  useFieldOperatorStore.setState({ overrideResult: null });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Step 6 manual override console", () => {
  it("shows approved policy ranges and keeps the slider and numeric input synchronized", () => {
    renderConsole();

    expect(screen.getByText("Policy: 2 to 8°C")).toBeInTheDocument();
    expect(screen.getByText("Policy: 30 to 70% RH")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Temperature target slider"), {
      target: { value: "9.5" },
    });
    expect(screen.getByRole("spinbutton", { name: "Temperature target (°C)" })).toHaveValue(9.5);
  });

  it("sends a held target with the agreed ramp, expiry, and request metadata", async () => {
    const user = userEvent.setup();
    const sendCommand = renderConsole();
    await user.click(screen.getByRole("button", { name: "Apply override" }));

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OVERRIDE",
        shipmentId: "SHIP-1",
        temperature: 5,
        behavior: "hold",
        durationMinutes: 10,
        rampDuration: 0,
        expiresInMs: 600000,
        reason: "Field operator synthetic override",
        requestId: expect.any(String),
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for server confirmation");
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
  });

  it("includes separate simulated ramp and hold durations", async () => {
    const user = userEvent.setup();
    const sendCommand = renderConsole();
    await user.selectOptions(screen.getByRole("combobox", { name: "Behavior" }), "ramp");
    fireEvent.change(screen.getByRole("spinbutton", { name: /Ramp duration/ }), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Hold override/ }), {
      target: { value: "12" },
    });
    await user.click(screen.getByRole("button", { name: "Apply override" }));

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "ramp",
        rampDuration: 4,
        durationMinutes: 12,
        expiresInMs: 960000,
      }),
    );
  });

  it("requires confirmation for targets beyond twice the policy-range span", async () => {
    const user = userEvent.setup();
    const sendCommand = renderConsole();
    fireEvent.change(screen.getByLabelText("Temperature target slider"), {
      target: { value: "-20" },
    });
    vi.mocked(window.confirm).mockReturnValueOnce(false);

    await user.click(screen.getByRole("button", { name: "Apply override" }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("fills the High Humidity synthetic preset and sends the target after Apply", async () => {
    const user = userEvent.setup();
    const sendCommand = renderConsole();
    await user.click(screen.getByRole("button", { name: "High Humidity" }));
    await user.click(screen.getByRole("button", { name: "Apply override" }));

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OVERRIDE",
        humidity: 85,
        presetName: "High Humidity",
      }),
    );
  });

  it("sends Return to Auto as an explicit release command", async () => {
    const user = userEvent.setup();
    const sendCommand = renderConsole();
    await user.click(screen.getByRole("button", { name: "Return to Auto" }));

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "RELEASE_OVERRIDE",
        shipmentId: "SHIP-1",
        requestId: expect.any(String),
      }),
    );
  });

  it("shows an authoritative countdown from the active override and simulation clock", () => {
    renderConsole({
      activeOverride: {
        status: "ACTIVE",
        targetTemperature: 10,
        expiresAt: "2026-01-01T00:08:00.000Z",
      },
    });

    expect(screen.getByText("Temp 10°C")).toBeInTheDocument();
    expect(screen.getByText("8m 00s simulated time remaining")).toBeInTheDocument();
  });

  it("sends bounded GPS drift only when the toggle is enabled", async () => {
    const user = userEvent.setup();
    const sendCommand = renderConsole();
    await user.click(screen.getByLabelText("Simulate GPS drift"));
    fireEvent.change(screen.getByLabelText("Latitude offset (°)"), { target: { value: "0.004" } });
    fireEvent.change(screen.getByLabelText("Longitude offset (°)"), {
      target: { value: "-0.003" },
    });
    await user.click(screen.getByRole("button", { name: "Apply GPS position" }));

    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "GPS_OVERRIDE",
        latOffset: 0.004,
        lngOffset: -0.003,
        requestId: expect.any(String),
      }),
    );
  });

  it("rejects GPS offsets outside the documented drift range", async () => {
    const user = userEvent.setup();
    const sendCommand = renderConsole();
    await user.click(screen.getByLabelText("Simulate GPS drift"));
    fireEvent.change(screen.getByLabelText("Latitude offset (°)"), { target: { value: "0.02" } });
    await user.click(screen.getByRole("button", { name: "Apply GPS position" }));

    expect(sendCommand).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("between −0.01 and +0.01 degrees");
  });

  it("blocks application while disconnected and reports a readable error", async () => {
    const user = userEvent.setup();
    const sendCommand = renderConsole({ connectionStatus: "disconnected" });
    expect(screen.getByRole("button", { name: "Apply override" })).toBeDisabled();
    expect(screen.getByText("Connect to a shipment to control it")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Release all overrides" }));
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
