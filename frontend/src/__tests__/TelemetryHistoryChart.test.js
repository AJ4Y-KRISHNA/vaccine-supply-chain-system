import React from "react";
import { render, screen } from "@testing-library/react";
import TelemetryHistoryChart from "../components/TelemetryHistoryChart";

test("charts simulator, manual and CSV records with distinct accessible source markers", () => {
  const records = [
    { _id: "sim", source: "simulator", temperature: 5, humidity: 55 },
    { _id: "manual", source: "manual", temperature: 11, humidity: 58 },
    { _id: "csv", source: "csv", temperature: 6, humidity: 57 },
  ];
  const { container } = render(<TelemetryHistoryChart records={records} policy={{ minimumTemperature: 2, maximumTemperature: 8 }} shipmentId="SYNTHETIC-SHIP" />);
  const titles = [...container.querySelectorAll("title")].map(title => title.textContent.replace(/\s+/g, " "));
  expect(titles).toContain("Simulated reading: 5°C");
  expect(titles).toContain("Manual reading: 11°C · policy excursion");
  expect(titles).toContain("CSV reading: 6°C");
  expect(container.querySelectorAll("circle")).toHaveLength(1);
  expect(container.querySelectorAll("rect[x]")).toHaveLength(2);
  expect(container.querySelectorAll("path[d^='M']")).toHaveLength(3);
});
