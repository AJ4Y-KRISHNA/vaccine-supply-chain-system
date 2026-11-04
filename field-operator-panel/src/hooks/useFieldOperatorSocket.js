import { useCallback, useEffect, useRef } from "react";
import { useFieldOperatorStore } from "../stores/fieldOperatorStore.js";

const SOCKET_PROTOCOL = "field-operator.v1";
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTelemetry(payload, fallbackClock = null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const location = payload.location || {};
  return {
    readingId: typeof payload.readingId === "string" ? payload.readingId : null,
    sequenceNumber: finiteOrNull(payload.sequenceNumber),
    temperature: finiteOrNull(payload.temperature),
    humidity: finiteOrNull(payload.humidity),
    battery: finiteOrNull(payload.battery ?? payload.batteryLevel),
    speed: finiteOrNull(payload.speed ?? payload.speedKph),
    gpsLat: finiteOrNull(payload.gpsLat ?? location.lat ?? payload.latitude),
    gpsLng: finiteOrNull(payload.gpsLng ?? location.lng ?? payload.longitude),
    vehicleId: typeof payload.vehicleId === "string" ? payload.vehicleId : null,
    deviceId: typeof payload.deviceId === "string" ? payload.deviceId : null,
    source: typeof payload.source === "string" ? payload.source : "unknown",
    simulationClock:
      payload.simulationClock || payload.recordedAt || payload.timestamp || fallbackClock || null,
    alertsTriggered: Array.isArray(payload.alertsTriggered) ? payload.alertsTriggered : [],
    progress: finiteOrNull(payload.progress),
    status: typeof payload.status === "string" ? payload.status : null,
  };
}

function normalizeAlert(payload, shipmentId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const timestamp = payload.simulationClock || payload.timestamp || null;
  const metric = typeof payload.metric === "string" ? payload.metric : "unknown metric";
  const value = payload.value ?? null;
  const limit = payload.limit ?? null;
  const alertId =
    typeof payload.alertId === "string" && payload.alertId.trim()
      ? payload.alertId.trim()
      : `${shipmentId || "shipment"}:${timestamp || Date.now()}:${metric}:${value ?? ""}:${limit ?? ""}`;
  return {
    alertId,
    severity: typeof payload.severity === "string" ? payload.severity : "warning",
    metric,
    value,
    limit,
    duration: payload.duration ?? null,
    message:
      typeof payload.message === "string" ? payload.message : "A simulator alert was reported.",
    simulationClock: timestamp,
    status: typeof payload.status === "string" ? payload.status : null,
    phase: typeof payload.phase === "string" ? payload.phase : null,
    requiresQualityReview: Boolean(payload.requiresQualityReview),
    excursionStartedAt: payload.excursionStartedAt || null,
    excursionClosedAt: payload.excursionClosedAt || null,
    shipmentId: typeof payload.shipmentId === "string" ? payload.shipmentId : shipmentId,
  };
}

function makeSocketUrl(shipmentId) {
  const configured =
    import.meta.env.VITE_BACKEND_WS_URL ||
    `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  const url = new URL(configured, window.location.href);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  url.pathname = "/ws/field-operator";
  url.search = "";
  url.searchParams.set("shipmentId", shipmentId);
  return url.toString();
}

/** Connects to Step 8's endpoint and exposes Step 6 commands over the shipment socket. */
export default function useFieldOperatorSocket({ shipmentId, accessToken }) {
  const socketRef = useRef(null);
  const setConnection = useFieldOperatorStore((state) => state.setConnection);
  const setInitMessage = useFieldOperatorStore((state) => state.setInitMessage);
  const setReading = useFieldOperatorStore((state) => state.setReading);
  const addAlert = useFieldOperatorStore((state) => state.addAlert);
  const setOverrideResult = useFieldOperatorStore((state) => state.setOverrideResult);
  const setActiveOverride = useFieldOperatorStore((state) => state.setActiveOverride);
  const setStatusChange = useFieldOperatorStore((state) => state.setStatusChange);

  const sendCommand = useCallback((command) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return { ok: false, error: "The shipment connection is not ready. Reconnect and try again." };
    }
    try {
      socket.send(JSON.stringify(command));
      return { ok: true };
    } catch {
      return { ok: false, error: "The command could not be sent. Check the connection and retry." };
    }
  }, []);

  useEffect(() => {
    if (!shipmentId || !accessToken) {
      setConnection("idle");
      return undefined;
    }

    let active = true;
    let retryCount = 0;
    let retryTimer;
    let socket;
    const socketUrl = makeSocketUrl(shipmentId);

    const scheduleReconnect = () => {
      if (!active) return;
      const delay = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
      retryCount += 1;
      setConnection("reconnecting", retryCount, `Retrying in ${Math.ceil(delay / 1000)} seconds.`);
      retryTimer = window.setTimeout(connect, delay);
    };

    const handleMessage = (event) => {
      if (typeof event.data !== "string") return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        setConnection("connected", retryCount, "Received an unreadable backend message.");
        return;
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) return;

      if (message.type === "INIT") {
        if (message.shipmentId && message.shipmentId !== shipmentId) {
          setConnection(
            "connected",
            retryCount,
            "The backend returned data for a different shipment.",
          );
          return;
        }
        const clock = message.currentState?.simulationClock || null;
        const latest = normalizeTelemetry(message.currentState?.latestReading, clock);
        const history = Array.isArray(message.currentState?.readingHistory)
          ? message.currentState.readingHistory
              .map((reading) => normalizeTelemetry(reading, clock))
              .filter(Boolean)
          : [];
        const alerts = Array.isArray(message.currentState?.alerts)
          ? message.currentState.alerts
              .map((alert) => normalizeAlert(alert, shipmentId))
              .filter(Boolean)
          : [];
        setInitMessage(message, latest, history, alerts);
      } else if (message.type === "READING") {
        setReading(normalizeTelemetry(message, message.simulationClock));
        if (Object.prototype.hasOwnProperty.call(message, "activeOverride")) {
          setActiveOverride(message.activeOverride);
        }
      } else if (message.type === "OVERRIDE_RESULT") {
        setOverrideResult(message);
      } else if (message.type === "ALERT") {
        if (message.shipmentId && message.shipmentId !== shipmentId) return;
        const alert = normalizeAlert(message, shipmentId);
        if (alert) addAlert(alert);
      } else if (message.type === "STATUS_CHANGE") {
        setStatusChange(message);
      }
    };

    function connect() {
      if (!active) return;
      setConnection(retryCount ? "reconnecting" : "connecting", retryCount);
      try {
        // Browser WebSocket cannot set Authorization headers. Offer the JWT as a
        // subprotocol (never in the URL); Step 8 must validate it and select the
        // non-secret field-operator.v1 protocol in its upgrade handler.
        socket = new WebSocket(socketUrl, [SOCKET_PROTOCOL, `bearer.${accessToken}`]);
        socketRef.current = socket;
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (!active) return;
        retryCount = 0;
        setConnection("connected");
      };
      socket.onmessage = handleMessage;
      socket.onerror = () => {
        if (active) setConnection("reconnecting", retryCount, "WebSocket connection failed.");
      };
      socket.onclose = () => scheduleReconnect();
    }

    connect();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
        if (socketRef.current === socket) socketRef.current = null;
      }
    };
  }, [
    accessToken,
    shipmentId,
    setConnection,
    setInitMessage,
    setReading,
    addAlert,
    setOverrideResult,
    setActiveOverride,
    setStatusChange,
  ]);

  return { sendCommand };
}

export { normalizeAlert, normalizeTelemetry };
