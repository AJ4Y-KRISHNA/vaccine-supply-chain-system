import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TruckRoadScene from "./TruckRoadScene.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockMotionPreference(matches) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("TruckRoadScene", () => {
  it("renders each supported status color", () => {
    for (const [statusColor, label] of [
      ["green", "Within policy limits"],
      ["amber", "Review required"],
      ["red", "Critical · quarantine"],
    ]) {
      const { unmount } = render(<TruckRoadScene statusColor={statusColor} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("keeps wheel rotation and road movement stopped when the truck is parked", () => {
    render(<TruckRoadScene isMoving={false} speed={60} />);
    expect(screen.getAllByTestId("truck-wheel-rotation")[0]).toHaveAttribute(
      "data-moving",
      "false",
    );
    expect(screen.getByTestId("road-lines")).toHaveAttribute("data-moving", "false");
    expect(screen.getByRole("img")).not.toHaveClass("scene-moving");
  });

  it("shows a quarantine badge when the shipment is quarantined", () => {
    render(<TruckRoadScene isQuarantined />);
    expect(screen.getByTestId("quarantine-badge")).toBeInTheDocument();
  });

  it("does not show a quarantine badge for a non-quarantined shipment", () => {
    render(<TruckRoadScene isQuarantined={false} statusColor="green" />);
    expect(screen.queryByTestId("quarantine-badge")).not.toBeInTheDocument();
  });

  it("marks the lane animation active only while the truck is moving", () => {
    const { rerender } = render(<TruckRoadScene isMoving speed={60} />);
    expect(screen.getByTestId("road-lines")).toHaveAttribute("data-moving", "true");
    rerender(<TruckRoadScene isMoving={false} speed={60} />);
    expect(screen.getByTestId("road-lines")).toHaveAttribute("data-moving", "false");
  });

  it("renders a distinct weather layer for each scenario", () => {
    const { rerender } = render(<TruckRoadScene weatherState="clear" />);
    expect(screen.getByTestId("weather-overlay")).toHaveAttribute("data-weather", "clear");
    rerender(<TruckRoadScene weatherState="heat" />);
    expect(
      screen.getByTestId("weather-overlay").querySelector(".scene-heat-haze"),
    ).toBeInTheDocument();
    rerender(<TruckRoadScene weatherState="rain" />);
    expect(screen.getByTestId("weather-overlay").querySelectorAll("line")).toHaveLength(72);
    rerender(<TruckRoadScene weatherState="cold" />);
    expect(screen.getByTestId("weather-overlay").querySelectorAll("circle")).toHaveLength(30);
  });

  it("renders a static scene when reduced motion is requested", () => {
    mockMotionPreference(true);
    render(<TruckRoadScene isMoving speed={60} />);
    expect(screen.getByRole("img")).toHaveClass("scene-reduced-motion");
    expect(screen.getByTestId("road-lines")).toHaveAttribute("data-moving", "false");
    expect(screen.getAllByTestId("truck-wheel-rotation")[0]).toHaveAttribute(
      "data-moving",
      "false",
    );
  });

  it("pauses CSS motion while the document is hidden and resumes when visible", () => {
    mockMotionPreference(false);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<TruckRoadScene isMoving speed={60} />);
    expect(screen.getByRole("img")).toHaveClass("scene-paused");
    act(() => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByRole("img")).not.toHaveClass("scene-paused");
  });

  it("shows temperature and humidity from the supplied readings", () => {
    render(<TruckRoadScene temperature={5.25} humidity={61.8} />);
    expect(screen.getByText("5.3°C")).toBeInTheDocument();
    expect(screen.getByText("61.8%")).toBeInTheDocument();
  });

  it("positions the route progress marker at the supplied progress and retains the destination", () => {
    const { rerender } = render(<TruckRoadScene progress={0} />);
    expect(screen.getByTestId("destination-pin")).toBeInTheDocument();
    expect(screen.getByTestId("progress-marker")).toHaveAttribute("transform", "translate(310 0)");
    rerender(<TruckRoadScene progress={50} />);
    expect(screen.getByTestId("progress-marker")).toHaveAttribute("transform", "translate(775 0)");
  });
});
