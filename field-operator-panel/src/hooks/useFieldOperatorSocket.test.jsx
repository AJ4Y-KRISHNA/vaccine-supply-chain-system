import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useFieldOperatorSocket, { normalizeAlert } from "./useFieldOperatorSocket.js";
import { useFieldOperatorStore } from "../stores/fieldOperatorStore.js";

const sockets = [];

class MockWebSocket {
  static OPEN = 1;

  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    sockets.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  send(payload) {
    this.sentMessages ||= [];
    this.sentMessages.push(JSON.parse(payload));
  }

  sendMessage(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function SocketHarness(props) {
  useFieldOperatorSocket(props);
  return null;
}

beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubEnv("VITE_BACKEND_WS_URL", "");
  useFieldOperatorStore.setState({
    accessToken: "",
    selectedShipmentId: "",
    connectionStatus: "idle",
    reconnectAttempt: 0,
    connectionError: "",
    initMessage: null,
    telemetry: null,
    readingHistory: [],
    alerts: [],
    progress: null,
    coldChainStatus: "unknown",
    shipmentStatus: null,
    statusChangeReason: "",
    simulationClock: null,
    activeOverride: null,
    overrideResult: null,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useFieldOperatorSocket", () => {
  it("normalizes alert events and attaches the active shipment when omitted by the protocol", () => {
    expect(
      normalizeAlert(
        {
          severity: "critical",
          metric: "temperature",
          value: 10.8,
          limit: 8,
          duration: 18,
          message: "Temperature exceeded the approved maximum.",
          simulationClock: "2026-01-01T00:18:00.000Z",
        },
        "SHIP-1",
      ),
    ).toEqual({
      alertId: expect.stringContaining("SHIP-1:"),
      severity: "critical",
      metric: "temperature",
      value: 10.8,
      limit: 8,
      duration: 18,
      message: "Temperature exceeded the approved maximum.",
      simulationClock: "2026-01-01T00:18:00.000Z",
      status: null,
      phase: null,
      requiresQualityReview: false,
      excursionStartedAt: null,
      excursionClosedAt: null,
      shipmentId: "SHIP-1",
    });
  });

  it("stores matching ALERT pushes, ignores another shipment, and de-duplicates repeats", () => {
    render(<SocketHarness shipmentId="SHIP-1" accessToken="token" />);
    act(() => sockets[0].open());
    const event = {
      type: "ALERT",
      shipmentId: "SHIP-1",
      alertId: "ALERT-1",
      severity: "critical",
      metric: "temperature",
      value: 10.8,
      limit: 8,
      duration: 18,
      message: "Quarantine requested.",
      simulationClock: "2026-01-01T00:18:00.000Z",
    };
    act(() => {
      sockets[0].sendMessage({ ...event, shipmentId: "SHIP-OTHER" });
      sockets[0].sendMessage(event);
      sockets[0].sendMessage(event);
    });

    expect(useFieldOperatorStore.getState().alerts).toEqual([
      expect.objectContaining({ alertId: "ALERT-1", shipmentId: "SHIP-1", read: false }),
    ]);
  });

  it("applies a later severity and resolution update for an existing alert id", () => {
    render(<SocketHarness shipmentId="SHIP-1" accessToken="token" />);
    act(() => {
      sockets[0].open();
      sockets[0].sendMessage({ type: "ALERT", shipmentId: "SHIP-1", alertId: "ALERT-1",
        severity: "warning", status: "ACTIVE", phase: "REVIEW_REQUIRED", message: "Review required." });
      sockets[0].sendMessage({ type: "ALERT", shipmentId: "SHIP-1", alertId: "ALERT-1",
        severity: "critical", status: "ACTIVE", phase: "QUARANTINED", requiresQualityReview: true,
        message: "Quarantined pending review." });
    });

    expect(useFieldOperatorStore.getState().alerts).toEqual([
      expect.objectContaining({ alertId: "ALERT-1", severity: "critical", phase: "QUARANTINED",
        requiresQualityReview: true, message: "Quarantined pending review." }),
    ]);
  });

  it("connects with a shipment query and keeps its bearer token out of the URL", () => {
    render(<SocketHarness shipmentId="SHIP-1" accessToken="secret.jwt.value" />);

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain("/ws/field-operator?shipmentId=SHIP-1");
    expect(sockets[0].url).not.toContain("secret.jwt.value");
    expect(sockets[0].protocols).toEqual(["field-operator.v1", "bearer.secret.jwt.value"]);
    expect(useFieldOperatorStore.getState().connectionStatus).toBe("connecting");
  });

  it("parses INIT and READING messages into normalized shipment telemetry", () => {
    render(<SocketHarness shipmentId="SHIP-1" accessToken="token" />);
    act(() => {
      sockets[0].open();
      sockets[0].sendMessage({
        type: "INIT",
        shipmentId: "SHIP-1",
        batchId: "BATCH-1",
        vaccineType: "Demo vaccine",
        policyLimits: { tempMin: 2, tempMax: 8 },
        routeInfo: { origin: "Origin", destination: "Clinic", totalDistanceKm: 30 },
        currentState: {
          latestReading: { temperature: 5, humidity: 50, batteryLevel: 98, recordedAt: "t0" },
          progress: 22,
          status: "Normal",
          activeOverride: null,
        },
      });
      sockets[0].sendMessage({
        type: "READING",
        temperature: 6.25,
        humidity: 51,
        battery: 97,
        gpsLat: "9.93",
        gpsLng: "76.26",
        source: "auto-simulated",
        simulationClock: "t1",
        progress: 24,
      });
    });

    const state = useFieldOperatorStore.getState();
    expect(state.connectionStatus).toBe("connected");
    expect(state.initMessage.batchId).toBe("BATCH-1");
    expect(state.progress).toBe(24);
    expect(state.telemetry).toMatchObject({
      temperature: 6.25,
      humidity: 51,
      battery: 97,
      gpsLat: 9.93,
      gpsLng: 76.26,
      source: "auto-simulated",
      simulationClock: "t1",
    });
    expect(state.readingHistory).toHaveLength(2);
  });

  it("restores persisted sensor samples and alert lifecycle data from INIT", () => {
    render(<SocketHarness shipmentId="SHIP-1" accessToken="token" />);
    act(() => {
      sockets[0].open();
      sockets[0].sendMessage({
        type: "INIT",
        shipmentId: "SHIP-1",
        currentState: {
          latestReading: { temperature: 5, humidity: 50, recordedAt: "2026-01-01T00:02:00Z" },
          readingHistory: [
            { temperature: 4, humidity: 48, simulationClock: "2026-01-01T00:00:00Z", source: "auto-simulated" },
            { temperature: 10, humidity: 50, simulationClock: "2026-01-01T00:01:00Z", status: "QUARANTINED" },
            { temperature: 5, humidity: 50, simulationClock: "2026-01-01T00:02:00Z" },
          ],
          alerts: [{ alertId: "ALERT-1", severity: "critical", metric: "temperature", value: 10,
            message: "Excursion quarantined.", phase: "QUARANTINED", simulationClock: "2026-01-01T00:01:00Z",
            excursionStartedAt: "2026-01-01T00:00:00Z", requiresQualityReview: true }],
        },
      });
    });

    expect(useFieldOperatorStore.getState().readingHistory).toHaveLength(3);
    expect(useFieldOperatorStore.getState().readingHistory[1]).toMatchObject({
      temperature: 10,
      status: "QUARANTINED",
    });
    expect(useFieldOperatorStore.getState().alerts).toEqual([
      expect.objectContaining({ alertId: "ALERT-1", phase: "QUARANTINED", acknowledged: false }),
    ]);
  });

  it("stores shipment status changes separately from cold-chain status", () => {
    render(<SocketHarness shipmentId="SHIP-1" accessToken="token" />);
    act(() => {
      sockets[0].open();
      sockets[0].sendMessage({
        type: "STATUS_CHANGE",
        newStatus: "Delivery Confirmed by Hospital",
        reason: "Hospital receipt was recorded.",
        simulationClock: "2026-01-01T00:20:00.000Z",
      });
    });

    expect(useFieldOperatorStore.getState()).toMatchObject({
      shipmentStatus: "Delivery Confirmed by Hospital",
      statusChangeReason: "Hospital receipt was recorded.",
      simulationClock: "2026-01-01T00:20:00.000Z",
      coldChainStatus: "unknown",
    });
  });

  it("sends override commands only through the connected shipment socket and stores server results", () => {
    let socketApi;
    function CommandHarness(props) {
      socketApi = useFieldOperatorSocket(props);
      return null;
    }
    render(<CommandHarness shipmentId="SHIP-1" accessToken="token" />);
    act(() => sockets[0].open());
    const command = { type: "OVERRIDE", requestId: "req-1", temperature: 9, behavior: "hold" };

    let sendResult;
    act(() => {
      sendResult = socketApi.sendCommand(command);
    });
    expect(sendResult).toEqual({ ok: true });
    expect(sockets[0].sentMessages).toEqual([command]);

    act(() =>
      sockets[0].sendMessage({
        type: "OVERRIDE_RESULT",
        requestId: "req-1",
        command: "OVERRIDE",
        status: "accepted",
        activeOverride: { status: "ACTIVE", expiresAt: "2026-01-01T00:10:00.000Z" },
      }),
    );
    expect(useFieldOperatorStore.getState().overrideResult.status).toBe("accepted");
    expect(useFieldOperatorStore.getState().activeOverride.status).toBe("ACTIVE");
  });

  it("reconnects with exponential backoff capped at 30 seconds", () => {
    vi.useFakeTimers();
    render(<SocketHarness shipmentId="SHIP-1" accessToken="token" />);

    act(() => sockets[0].close());
    expect(useFieldOperatorStore.getState().connectionStatus).toBe("reconnecting");
    expect(useFieldOperatorStore.getState().reconnectAttempt).toBe(1);
    act(() => vi.advanceTimersByTime(999));
    expect(sockets).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(sockets).toHaveLength(2);

    act(() => sockets[1].close());
    act(() => vi.advanceTimersByTime(2000));
    expect(sockets).toHaveLength(3);
  });

  it("does not open a socket without both an access token and a shipment", () => {
    render(<SocketHarness shipmentId="SHIP-1" accessToken="" />);
    expect(sockets).toHaveLength(0);
    expect(useFieldOperatorStore.getState().connectionStatus).toBe("idle");
  });
});
