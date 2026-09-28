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
  progress: null,
  coldChainStatus: "unknown",
  activeOverride: null,
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
      progress: null,
      coldChainStatus: "unknown",
      activeOverride: null,
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
      progress: null,
      coldChainStatus: "unknown",
      activeOverride: null,
      simulationClock: null,
    }),
  setConnection: (connectionStatus, reconnectAttempt = 0, connectionError = "") =>
    set({ connectionStatus, reconnectAttempt, connectionError }),
  setInitMessage: (message, telemetry) =>
    set({
      initMessage: message,
      telemetry: telemetry || null,
      readingHistory: telemetry ? [telemetry] : [],
      progress:
        message.currentState?.progress !== null &&
        message.currentState?.progress !== undefined &&
        Number.isFinite(Number(message.currentState.progress))
          ? Number(message.currentState.progress)
          : null,
      coldChainStatus: message.currentState?.status || "unknown",
      activeOverride: message.currentState?.activeOverride || null,
      simulationClock: telemetry?.simulationClock || message.currentState?.simulationClock || null,
    }),
  setReading: (telemetry) =>
    set((state) => ({
      telemetry,
      readingHistory: [...state.readingHistory, telemetry].slice(-30),
      simulationClock: telemetry.simulationClock || state.simulationClock,
      progress:
        telemetry.progress !== null &&
        telemetry.progress !== undefined &&
        Number.isFinite(Number(telemetry.progress))
          ? Number(telemetry.progress)
          : state.progress,
      coldChainStatus: telemetry.status || state.coldChainStatus,
    })),
}));

export { readShipmentIdFromUrl };
