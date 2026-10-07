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
      contract: { addressConfigured: true, artifactAvailable: true, deployed: true, bytecodePresent: true, bytecodeBytes: 1024, status: "ready" } },
    ai: { service: "FastAPI AI service", status: "healthy", reachable: true, healthy: true, latencyMs: 120 },
    mqtt: { service: "Mosquitto MQTT", status: "healthy", reachable: true, healthy: true, latencyMs: 8, transport: "mqtt" },
    redis: { service: "Redis", status: "healthy", reachable: true, healthy: true, latencyMs: 3 },
    email: { service: "Ethereal demo email", status: "healthy", reachable: true, healthy: true, latencyMs: 220,
      mode: "ethereal", simulated: true, previewAvailable: true },
    auditAnchoring: { enabled: true, ready: true, status: "ready", writerConfigured: true, writerAuthorized: true,
      counts: { temperatureHistory: { total: 4, confirmed: 3, pending: 1, failed: 0, rawOnChainConfirmed: 3, rawOnChainPending: 1, rawOnChainFailed: 0 }, coldChainAudit: { total: 2, confirmed: 2, pending: 0, failed: 0 } } },
  });
});

test("Merkle readiness distinguishes root commitments from legacy raw telemetry", async () => {
  const fixture = await fetchSystemReadiness();
  fixture.merkleAnchoring = { healthy: true, windowsConfirmed: 2, windowsWaiting: 1, readingsCollecting: 4 };
  fixture.auditAnchoring.evidence = { rawTelemetryOnChain: false };
  fetchSystemReadiness.mockResolvedValue(fixture);
  render(<SystemReadinessPanel />);
  expect(await screen.findByText(/only roots and metadata go on-chain/)).toBeInTheDocument();
  expect(screen.getByText(/Confirmed windows: 2.*Waiting windows: 1.*Collecting readings: 4/)).toBeInTheDocument();
  expect(screen.queryByText(/includes an append-only raw record/)).not.toBeInTheDocument();
});

test("readiness clearly labels manual data mode and disabled simulator controls", async () => {
  fetchSystemReadiness.mockResolvedValue({ dataMode: { mode: "manual", label: "manual mode", simulatorEnabled: false } });
  render(<SystemReadinessPanel />);
  expect(await screen.findByRole("status")).toHaveTextContent("Data mode: manual mode");
  expect(screen.getByRole("status")).toHaveTextContent("Simulator endpoints are disabled; manual entry remains available.");
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
  expect(within(blockchain).getByText("Chain ID: 31337")).toBeInTheDocument();
  expect(within(blockchain).getByText("Contract bytecode: Present (1024 bytes)")).toBeInTheDocument();

  const ai = screen.getByRole("article", { name: "AI decision service health status" });
  expect(within(ai).getByText("120 ms")).toBeInTheDocument();
  expect(within(ai).getByText("Passed")).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "MQTT broker health status" })).toHaveTextContent("Healthy");
  expect(screen.getByRole("article", { name: "Redis health status" })).toHaveTextContent("Healthy");
  expect(screen.getByRole("article", { name: "Demo email health status" })).toHaveTextContent("ethereal");
  const anchoring = screen.getByRole("article", { name: "Cold-chain history anchoring status" });
  expect(within(anchoring).getByText("Feature enabled: Yes · Local writer configured: Yes · Contract permission: Yes")).toBeInTheDocument();
  expect(within(anchoring).getByText(/Reading digests — total 4, confirmed 3, waiting 1, failed 0/)).toBeInTheDocument();
  expect(within(anchoring).getByText(/append-only raw record on the local chain/)).toBeInTheDocument();
  expect(within(anchoring).getByText(/Raw readings on local chain — confirmed 3, waiting 1, failed 0/)).toBeInTheDocument();
  expect(screen.getByText(/Reachable.*Healthy/s)).toBeInTheDocument();
});

test("email readiness labels a slow probe with working Ethereal capture as degraded", async () => {
  fetchSystemReadiness.mockResolvedValue({ email: { service: "Ethereal demo email", status: "degraded", reachable: true, healthy: false,
      latencyMs: 10000, mode: "ethereal", simulated: true, previewAvailable: true,
      failure: "smtp-probe-timeout-capture-confirmed" } });
  render(<SystemReadinessPanel />);
  const card = await screen.findByRole("article", { name: "Demo email health status" });
  expect(card).toHaveTextContent("Degraded — capture works; probe slow");
  expect(card).toHaveTextContent("Capture confirmed; probe timed out");
});
