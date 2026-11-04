import { create } from "zustand";

const SESSION_TOKEN_KEY = "fieldOperator.accessToken";
const SESSION_IDENTITY_KEY = "fieldOperator.identity";

function readSession() {
  if (typeof window === "undefined") return { token: "", identity: null, role: "" };
  try {
    return {
      token: window.sessionStorage.getItem(SESSION_TOKEN_KEY) || "",
      identity: JSON.parse(window.sessionStorage.getItem(SESSION_IDENTITY_KEY) || "null"),
      role: window.sessionStorage.getItem("fieldOperator.role") || "",
    };
  } catch {
    return { token: "", identity: null, role: "" };
  }
}

function readShipmentIdFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("shipmentId")?.trim() || "";
}

const session = readSession();

function readingIdentity(reading) {
  if (reading.readingId) return `id:${reading.readingId}`;
  const clock = reading.simulationClock || "";
  const device = reading.deviceId || "";
  if (reading.sequenceNumber !== null && reading.sequenceNumber !== undefined) return `seq:${device}:${reading.sequenceNumber}:${clock}`;
  return `sample:${device}:${clock}:${reading.temperature ?? ""}:${reading.humidity ?? ""}:${reading.gpsLat ?? ""}:${reading.gpsLng ?? ""}`;
}

function mergeReadings(existing = [], incoming = []) {
  const indexed = new Map();
  for (const reading of [...existing, ...incoming]) {
    if (reading && typeof reading === "object") indexed.set(readingIdentity(reading), reading);
  }
  return [...indexed.values()].sort((a, b) => {
    const first = Date.parse(a.simulationClock || "");
    const second = Date.parse(b.simulationClock || "");
    if (Number.isFinite(first) && Number.isFinite(second) && first !== second) return first - second;
    return Number(a.sequenceNumber ?? 0) - Number(b.sequenceNumber ?? 0);
  });
}

export const useFieldOperatorStore = create((set) => ({
  accessToken: session.token,
  identity: session.identity,
  role: session.role,
  shipments: [],
  shipmentLoadStatus: "idle",
  shipmentLoadError: "",
  selectedShipmentId: readShipmentIdFromUrl(),
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
  activeOverride: null,
  overrideResult: null,
  simulationClock: null,

  setSession: ({ token, identity, role }) => {
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    window.sessionStorage.setItem(SESSION_IDENTITY_KEY, JSON.stringify(identity || null));
    window.sessionStorage.setItem("fieldOperator.role", role || "");
    set({ accessToken: token, identity: identity || null, role: role || "" });
  },

  clearSession: () => {
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    window.sessionStorage.removeItem(SESSION_IDENTITY_KEY);
    window.sessionStorage.removeItem("fieldOperator.role");
    set({
      accessToken: "",
      identity: null,
      role: "",
      shipments: [],
      shipmentLoadStatus: "idle",
      shipmentLoadError: "",
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
      activeOverride: null,
      overrideResult: null,
      simulationClock: null,
    });
  },

  setShipmentsLoading: () => set({ shipmentLoadStatus: "loading", shipmentLoadError: "" }),
  setShipments: (shipments) =>
    set({ shipments, shipmentLoadStatus: "ready", shipmentLoadError: "" }),
  setShipmentsError: (error) => set({ shipmentLoadStatus: "error", shipmentLoadError: error }),
  setShipmentId: (shipmentId) =>
    set({
      selectedShipmentId: shipmentId,
      connectionStatus: shipmentId ? "connecting" : "idle",
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
      activeOverride: null,
      overrideResult: null,
      simulationClock: null,
    }),
  setConnection: (connectionStatus, reconnectAttempt = 0, connectionError = "") =>
    set({ connectionStatus, reconnectAttempt, connectionError }),
  setInitMessage: (message, telemetry, history = [], alerts = []) =>
    set({
      initMessage: message,
      telemetry: telemetry || null,
      readingHistory: mergeReadings([], history.length ? history : telemetry ? [telemetry] : []),
      alerts: alerts.slice(-100).map((alert) => ({ ...alert, read: false, acknowledged: false })),
      progress:
        message.currentState?.progress !== null &&
        message.currentState?.progress !== undefined &&
        Number.isFinite(Number(message.currentState.progress))
          ? Number(message.currentState.progress)
          : null,
      coldChainStatus: message.currentState?.status || "unknown",
      shipmentStatus: message.shipmentStatus || message.currentState?.shipmentStatus || null,
      statusChangeReason: "",
      activeOverride: message.currentState?.activeOverride || null,
      simulationClock: telemetry?.simulationClock || message.currentState?.simulationClock || null,
    }),
  setReading: (telemetry) =>
    set((state) => ({
      telemetry,
      readingHistory: mergeReadings(state.readingHistory, [telemetry]),
      simulationClock: telemetry.simulationClock || state.simulationClock,
      progress:
        telemetry.progress !== null &&
        telemetry.progress !== undefined &&
        Number.isFinite(Number(telemetry.progress))
          ? Number(telemetry.progress)
          : state.progress,
      coldChainStatus: telemetry.status || state.coldChainStatus,
    })),
  setReadingHistory: (history) => set((state) => ({ readingHistory: mergeReadings(state.readingHistory, history) })),
  addAlert: (alert) =>
    set((state) => {
      const existingIndex = state.alerts.findIndex((existing) => existing.alertId === alert.alertId);
      if (existingIndex >= 0) {
        const alerts = [...state.alerts];
        const existing = alerts[existingIndex];
        alerts[existingIndex] = {
          ...existing,
          ...alert,
          read: existing.read,
          acknowledged: existing.acknowledged,
        };
        return { alerts };
      }
      return {
        alerts: [...state.alerts, { ...alert, read: false, acknowledged: false }].slice(-100),
      };
    }),
  acknowledgeAlert: (alertId) =>
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.alertId === alertId ? { ...alert, read: true, acknowledged: true } : alert,
      ),
    })),
  setOverrideResult: (result) =>
    set({
      overrideResult: result,
      ...(Object.prototype.hasOwnProperty.call(result || {}, "activeOverride")
        ? { activeOverride: result.activeOverride || null }
        : result?.command === "RELEASE_OVERRIDE" &&
            String(result.status || "").toLowerCase() === "accepted"
          ? { activeOverride: null }
          : {}),
    }),
  setActiveOverride: (activeOverride) => set({ activeOverride: activeOverride || null }),
  setStatusChange: (event) => set((state) => ({
    shipmentStatus: event?.newStatus || state.shipmentStatus,
    statusChangeReason: event?.reason || "",
    simulationClock: event?.simulationClock || state.simulationClock,
    ...(Object.prototype.hasOwnProperty.call(event || {}, "activeOverride")
      ? { activeOverride: event.activeOverride || null }
      : {}),
  })),
}));

export { readShipmentIdFromUrl };
export { mergeReadings, readingIdentity };
