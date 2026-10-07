import { useEffect, useState } from "react";

const PROTOCOL = "vaccine-dashboard.v1";
function socketUrl() {
  const configured = process.env.REACT_APP_API_BASE || "http://localhost:5000/api";
  const url = new URL(configured, window.location.href);
  url.pathname = "/ws/dashboard"; url.search = ""; url.hash = "";
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

const listeners = new Set();
let shared = { status: "degraded", event: null, revision: 0 };
let socket, retryTimer, retry = 500, connected = false, visibilityInstalled = false;
const emit = next => { shared = typeof next === "function" ? next(shared) : next; listeners.forEach(listener => listener(shared)); };
function connect() {
  if (typeof WebSocket === "undefined") { emit(current => ({ ...current, status: "degraded" })); return; }
  if (!listeners.size || document.visibilityState === "hidden" || socket?.readyState === WebSocket.CONNECTING || socket?.readyState === WebSocket.OPEN) return;
  const token = sessionStorage.getItem("token");
  if (!token) { emit(current => ({ ...current, status: "degraded" })); return; }
  let connection;
  try { connection = new WebSocket(socketUrl(), [PROTOCOL, `bearer.${token}`]); socket = connection; }
  catch (_) { schedule(); return; }
  connection.onopen = () => { connected = true; retry = 500; };
  connection.onmessage = message => {
    if (socket !== connection) return;
    let event; try { event = JSON.parse(message.data); } catch (_) { return; }
    if (event.type === "READY") emit(current => ({ ...current, status: "live" }));
    else emit(current => ({ status: "live", event, revision: current.revision + 1 }));
  };
  connection.onclose = () => { if (socket === connection) socket = null; connected = false; emit(current => ({ ...current, status: "degraded" })); schedule(); };
  connection.onerror = () => { try { connection.close(); } catch (_) {} };
}
function schedule() {
  if (!listeners.size || retryTimer) return;
  retryTimer = window.setTimeout(() => { retryTimer = null; retry = Math.min(10000, retry * 2); connect(); }, retry);
}
function onVisibility() {
  if (document.visibilityState === "hidden") { if (retryTimer) clearTimeout(retryTimer); retryTimer = null; socket?.close(); }
  else if (!connected) connect();
}
function onSessionChanged() {
  connected = false;
  const previous = socket; socket = null;
  try { previous?.close(4001, "Session changed"); } catch (_) {}
  emit(current => ({ ...current, status: "degraded" }));
  if (sessionStorage.getItem("token")) connect();
}
export default function useDashboardRealtime() {
  const [state, setState] = useState(shared);
  useEffect(() => {
    listeners.add(setState);
    if (!visibilityInstalled) { document.addEventListener("visibilitychange", onVisibility); visibilityInstalled = true; }
    window.addEventListener("vaccine:session-changed", onSessionChanged);
    connect();
    return () => {
      listeners.delete(setState);
      if (!listeners.size) { if (retryTimer) clearTimeout(retryTimer); retryTimer = null; socket?.close(); socket = null;
        document.removeEventListener("visibilitychange", onVisibility); visibilityInstalled = false; }
      window.removeEventListener("vaccine:session-changed", onSessionChanged);
    };
  }, []);
  return state;
}
