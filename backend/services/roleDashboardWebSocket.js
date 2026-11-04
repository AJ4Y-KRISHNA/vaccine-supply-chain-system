const { WebSocketServer, WebSocket } = require("ws");
const { randomUUID } = require("node:crypto");
const { verifyAccessToken } = require("../middleware/auth");
const { identityKeys, identityPatterns, ownsIdentity } = require("../middleware/identityScope");
const Shipment = require("../models/Shipment");
const Batch = require("../models/Batch");
const events = require("./dashboardEventBus");
const logger = require("./structuredLogger");

const PATH = "/ws/dashboard";
const PROTOCOL = "vaccine-dashboard.v1";
const ROLES = new Set(["admin", "manufacturer", "distributor", "healthcare"]);
const ORG_FIELD = { distributor: "distributor", healthcare: "destination" };

function reject(socket, status, message) {
  if (socket.destroyed) return;
  const label = status === 404 ? "Not Found" : status === 403 ? "Forbidden" : status === 503 ? "Service Unavailable" : "Unauthorized";
  const body = `${message}\n`;
  socket.write(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  socket.destroy();
}

function allowedOrigins() {
  const configured = process.env.DASHBOARD_WS_ALLOWED_ORIGINS ?? process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000";
  return new Set(configured.split(",").map(value => value.trim()).filter(Boolean));
}

async function membership(user) {
  if (!ROLES.has(user.role)) throw new Error("Dashboard role unavailable");
  if (user.role === "admin") return { shipmentIds: new Set(), batchIds: new Set(), all: true };
  const patterns = identityPatterns(user);
  let batchIds = [];
  if (user.role === "manufacturer") {
    const batches = await Batch.find({ manufacturer: { $in: patterns } }).select("batchId").limit(5000).lean();
    batchIds = batches.map(row => row.batchId);
  }
  const shipmentFilter = user.role === "manufacturer" ? { batchId: { $in: batchIds } }
    : { [ORG_FIELD[user.role]]: { $in: patterns } };
  const shipments = await Shipment.find(shipmentFilter).select("shipmentId batchId").limit(5000).lean();
  return { shipmentIds: new Set(shipments.map(row => row.shipmentId)),
    batchIds: new Set([...batchIds, ...shipments.map(row => row.batchId)].filter(Boolean)), all: false };
}

function canReceive(context, event) {
  if (context.user.role === "admin") return !event.targetRole || event.targetRole === "admin" || !event.targetOrgKey;
  if (event.targetRole && event.targetRole !== context.user.role) return false;
  if (event.targetOrgKey && !ownsIdentity(context.user, event.targetOrgKey)) return false;
  if (event.shipmentId && context.scope.shipmentIds.has(event.shipmentId)) return true;
  if (event.shipmentIds?.some(id => context.scope.shipmentIds.has(id))) return true;
  return Boolean(event.batchId && context.scope.batchIds.has(event.batchId));
}

function attachRoleDashboardWebSocket(server, { WebSocketServerClass = WebSocketServer, heartbeatMs = 15000 } = {}) {
  const wss = new WebSocketServerClass({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const clients = new Set();
  let closed = false;
  const originSet = allowedOrigins();
  function onUpgrade(request, socket, head) {
    let url;
    try { url = new URL(request.url, "http://localhost"); } catch (_) { return; }
    if (url.pathname !== PATH) return;
    const origin = request.headers.origin;
    if (origin && !originSet.has(origin)) { reject(socket, 403, "Dashboard origin is not allowed"); return; }
    const protocols = String(request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim());
    const tokenEntries = protocols.filter(value => value.startsWith("bearer."));
    const token = tokenEntries.length === 1 ? tokenEntries[0].slice(7) : "";
    if (!protocols.includes(PROTOCOL) || !token || token.length > 4096) { reject(socket, 401, "Dashboard authentication required"); return; }
    verifyAccessToken(token).then(async user => {
      const scope = await membership(user);
      if (!ROLES.has(user.role)) return reject(socket, 403, "Dashboard role not allowed");
      if (socket.destroyed || closed) return;
      wss.handleUpgrade(request, socket, head, ws => {
        const keys = identityKeys(user);
        const context = { ws, user, token, scope, rooms: new Set([`role:${user.role}`, `organization:${user.role}:${keys.join("|")}`, `user:${user.id}`]) };
        ws.dashboardContext = context; ws.isAlive = true; clients.add(context);
        ws.on("pong", () => { ws.isAlive = true; });
        ws.on("message", () => ws.close(1008, "Dashboard channel is read only"));
        ws.on("close", () => clients.delete(context));
        ws.send(JSON.stringify({ type: "READY", role: user.role, correlationId: randomUUID(), rooms: [...context.rooms] }));
      });
    }).catch(error => reject(socket, error.status || 401, "Dashboard identity could not be verified"));
  }
  server.on("upgrade", onUpgrade);

  async function publishEvent(event) {
    if (closed || !event || typeof event.type !== "string") return 0;
    const envelope = { type: event.type, eventId: event.eventId || randomUUID(), correlationId: event.correlationId || null,
      occurredAt: new Date().toISOString(), data: event.data || {} };
    let sent = 0;
    for (const context of clients) {
      if (context.ws.readyState !== WebSocket.OPEN || !canReceive(context, event)) continue;
      try { context.ws.send(JSON.stringify(envelope)); sent++; } catch (_) { /* Socket delivery is best effort. */ }
    }
    logger.info("dashboard.websocket.broadcast", { eventId: envelope.eventId, correlationId: envelope.correlationId,
      eventType: envelope.type, subscriberCount: sent });
    return sent;
  }

  const heartbeat = setInterval(() => {
    for (const context of clients) {
      const ws = context.ws;
      if (ws.readyState !== WebSocket.OPEN) { clients.delete(context); continue; }
      if (!ws.isAlive) { clients.delete(context); ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) { clients.delete(context); ws.terminate(); }
    }
  }, heartbeatMs);
  heartbeat.unref?.();
  const publisher = { publishEvent };
  events.registerPublisher(publisher);
  async function close() {
    closed = true; clearInterval(heartbeat); server.off("upgrade", onUpgrade); events.unregisterPublisher(publisher);
    for (const context of clients) context.ws.close(1001, "Server shutting down");
    clients.clear(); await new Promise(resolve => wss.close(() => resolve()));
  }
  return { wss, close, publishEvent, endpoint: PATH, protocol: PROTOCOL };
}

module.exports = { attachRoleDashboardWebSocket, membership, canReceive, PATH, PROTOCOL };
