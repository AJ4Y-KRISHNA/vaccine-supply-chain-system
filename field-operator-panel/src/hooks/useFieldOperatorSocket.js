import { useEffect } from "react";
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

/** Connects to the Step 8 backend endpoint and handles the Step 4 INIT/READING protocol. */
export default function useFieldOperatorSocket({ shipmentId, accessToken }) {
  const setConnection = useFieldOperatorStore((state) => state.setConnection);
  const setInitMessage = useFieldOperatorStore((state) => state.setInitMessage);
  const setReading = useFieldOperatorStore((state) => state.setReading);

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
        setInitMessage(message, normalizeTelemetry(message.currentState?.latestReading, clock));
      } else if (message.type === "READING") {
        setReading(normalizeTelemetry(message, message.simulationClock));
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
      }
    };
  }, [accessToken, shipmentId, setConnection, setInitMessage, setReading]);
}

export { normalizeTelemetry };
