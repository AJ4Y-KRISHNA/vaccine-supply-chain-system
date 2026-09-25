import React from "react";
import { render, screen, within } from "@testing-library/react";
import SystemReadinessPanel from "../components/SystemReadinessPanel";
import { fetchSystemReadiness } from "../services/traceability";

jest.mock("../services/traceability", () => ({ fetchSystemReadiness: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  fetchSystemReadiness.mockResolvedValue({
    checkedAt: "2026-09-25T10:00:00.000Z",
    backend: { service: "backend API", status: "healthy", reachable: true, healthy: true, latencyMs: 4 },
    database: { service: "MongoDB", status: "unhealthy", reachable: true, healthy: false, latencyMs: 31 },
    blockchain: { service: "local blockchain", status: "healthy", reachable: true, healthy: true, latencyMs: 18,
      blockProgressed: true, blockNumber: 22, chainId: 31337,
      contract: { addressConfigured: true, artifactAvailable: true, deployed: true, status: "ready" } },
    ai: { service: "FastAPI AI service", status: "healthy", reachable: true, healthy: true, latencyMs: 120 },
  });
});

test("readiness panel displays reachability, functional result and latency separately for each service", async () => {
  render(<SystemReadinessPanel />);

  const database = await screen.findByRole("article", { name: "Database health status" });
  expect(within(database).getByText("Reachable")).toBeInTheDocument();
  expect(within(database).getByText("Yes")).toBeInTheDocument();
  expect(within(database).getByText("Functional check")).toBeInTheDocument();
  expect(within(database).getByText("Failed")).toBeInTheDocument();
  expect(within(database).getByText("31 ms")).toBeInTheDocument();

  const blockchain = screen.getByRole("article", { name: "Local blockchain health status" });
  expect(within(blockchain).getByText("Current block: 22")).toBeInTheDocument();
  expect(within(blockchain).getByText("Contract status: Ready")).toBeInTheDocument();

  const ai = screen.getByRole("article", { name: "AI decision service health status" });
  expect(within(ai).getByText("120 ms")).toBeInTheDocument();
  expect(within(ai).getByText("Passed")).toBeInTheDocument();
  expect(screen.getByText(/Reachable.*Healthy/s)).toBeInTheDocument();
});
