import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useFieldOperatorSocket from "./useFieldOperatorSocket.js";
import { useFieldOperatorStore } from "../stores/fieldOperatorStore.js";

const sockets = [];

class MockWebSocket {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    sockets.push(this);
  }

  open() {
    this.onopen?.();
  }

  sendMessage(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close() {
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
    progress: null,
    coldChainStatus: "unknown",
    simulationClock: null,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useFieldOperatorSocket", () => {
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
