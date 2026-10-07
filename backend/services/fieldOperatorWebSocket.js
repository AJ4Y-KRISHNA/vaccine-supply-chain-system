const { WebSocketServer, WebSocket } = require("ws");
const { verifyAccessToken } = require("../middleware/auth");
const { ownsIdentity } = require("../middleware/identityScope");
const Shipment = require("../models/Shipment");
const Batch = require("../models/Batch");
const ColdChainPolicy = require("../models/ColdChainPolicy");
const TemperatureLog = require("../models/TemperatureLog");
const SimulatorOverride = require("../models/SimulatorOverride");
const TemperatureAlert = require("../models/TemperatureAlert");
const { createOverride, releaseOverride, HARD_MAX_TTL_MS } = require("./simulatorOverrides");
const fieldOperatorEvents = require("./fieldOperatorEventBus");
const logger = require("./structuredLogger");

const ENDPOINT = "/ws/field-operator";
const PROTOCOL = "field-operator.v1";
const MAX_PAYLOAD = 16 * 1024;
const COMMANDS_PER_MINUTE = 30;
const AUTH_RECHECK_MS = 30_000;
const GRACE_POLL_MS = 500;

const statusProgress = shipment => {
  const statuses = [shipment.status, ...(shipment.statusHistory || []).map(entry => entry.status)]
    .filter(Boolean).join(" ").toLowerCase();
  if (/deliver|confirm|complete/.test(statuses) || shipment.hospitalConfirmed) return 100;
  if (/in transit|dispatched/.test(statuses)) return 58;
  if (/supplied|vaccination cent(?:er|re)/.test(statuses)) return 82;
  if (/verified|approved/.test(statuses)) return 28;
  if (/pending dispatch|ready/.test(statuses)) return 16;
  if (/pending|created/.test(statuses)) return 6;
  return 0;
};

const haversineKm = (from, to) => {
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(to.latitude - from.latitude);
  const dLng = radians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

function safeOverride(override) {
  if (!override) return null;
  const item = typeof override.toObject === "function" ? override.toObject() : override;
  return {
    overrideId: item.overrideId,
    shipmentId: item.shipmentId,
    batchId: item.batchId,
    mode: item.mode,
    status: item.status,
    presetId: item.presetId || null,
    effect: item.effect,
    ...(item.targetTemperature === undefined ? {} : { targetTemperature: item.targetTemperature }),
    ...(item.targetHumidity === undefined ? {} : { targetHumidity: item.targetHumidity }),
    behavior: item.behavior,
    rampDuration: item.rampDuration,
    holdDuration: item.holdDuration,
    effectiveAt: item.effectiveAt,
    expiresAt: item.expiresAt,
    releasedAt: item.releasedAt || null,
    reason: item.reason,
  };
}

function normaliseAlert(alert) {
  const metric = String(alert.metric || alert.violationType || "unknown").toLowerCase();
  const humidityMetric = metric.includes("humidity");
  const value = humidityMetric
    ? alert.currentReading?.humidity ?? alert.currentHumidity ?? null
    : metric.includes("temperature")
      ? alert.currentReading?.temperature ?? alert.currentTemperature ?? null
      : alert.currentReading?.temperature ?? alert.currentTemperature ?? alert.currentReading?.humidity ?? alert.currentHumidity ?? null;
  const limit = alert.breachedLimit ?? (humidityMetric
    ? alert.minimumAllowedHumidity ?? alert.maximumAllowedHumidity
    : alert.minimumAllowedTemperature ?? alert.maximumAllowedTemperature) ?? null;
  const durationMs = Number(alert.excursionDurationMs || 0);
  return {
    type: "ALERT",
    ...(alert.correlationId ? { correlationId: alert.correlationId } : {}),
    shipmentId: alert.shipmentId,
    alertId: alert.alertId,
    severity: String(alert.severity || "WARNING").toLowerCase(),
    metric,
    value,
    limit,
    duration: durationMs ? Math.round(durationMs / 60_000 * 100) / 100 : null,
    message: alert.reason || alert.recommendedAction || "A cold-chain event was recorded.",
    simulationClock: alert.latestReadingAt || alert.timestamp || null,
    status: alert.status || null,
    phase: alert.phase || null,
    requiresQualityReview: Boolean(alert.requiresQualityReview),
    excursionStartedAt: alert.excursionStartedAt || null,
    excursionClosedAt: alert.excursionClosedAt || null,
  };
}

function allowedOrigins() {
  const configured = process.env.FIELD_OPERATOR_WS_ALLOWED_ORIGINS;
  const base = configured === undefined
    ? [...(process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000").split(","),
      "http://localhost:5173", "http://127.0.0.1:5173"]
    : configured.split(",");
  return new Set(base.map(value => value.trim()).filter(Boolean));
}

function disconnectGraceMs() {
  const minutes = Number(process.env.FIELD_OPERATOR_DISCONNECT_GRACE_MINUTES ?? 2);
  if (!Number.isFinite(minutes) || minutes < 0.001 || minutes > 1440) return 2 * 60_000;
  return Math.round(minutes * 60_000);
}

function rejectUpgrade(socket, status, message) {
  if (socket.destroyed) return;
  const reason = ({ 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 503: "Service Unavailable" })[status] || "Bad Request";
  const body = `${message}\n`;
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n` +
    "Connection: close\r\n" + "Content-Type: text/plain; charset=utf-8\r\n" + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  socket.destroy();
}

function parseProtocols(request) {
  return String(request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim()).filter(Boolean);
}

function readBearerProtocol(protocols) {
  const bearer = protocols.filter(value => value.startsWith("bearer."));
  if (bearer.length !== 1) return null;
  const token = bearer[0].slice("bearer.".length);
  return token && token.length <= 4096 ? token : null;
}

function canReadShipment(user, shipment, batch) {
  if (user.role === "admin") return true;
  if (user.role === "manufacturer") return ownsIdentity(user, batch.manufacturer);
  if (user.role === "distributor") return ownsIdentity(user, shipment.distributor);
  if (user.role === "healthcare") return ownsIdentity(user, shipment.destination);
  return false;
}

async function loadShipmentContext(shipmentId, user, manager) {
  await manager.initialize();
  const shipment = await Shipment.findOne({ shipmentId }).lean();
  if (!shipment) throw Object.assign(new Error("Shipment is unavailable"), { status: 404 });
  const batch = await Batch.findOne({ batchId: shipment.batchId }).lean();
  if (!batch || !canReadShipment(user, shipment, batch)) throw Object.assign(new Error("Shipment is unavailable"), { status: 404 });

  let policy = null;
  if (batch.coldChainPolicyId) policy = await ColdChainPolicy.findById(batch.coldChainPolicyId).lean();
  const [recentLogs, recentAlerts] = await Promise.all([
    TemperatureLog.find({ shipmentId }).sort({ recordedAt: -1, _id: -1 }).limit(30).lean(),
    TemperatureAlert.find({ shipmentId }).sort({ timestamp: -1, _id: -1 }).limit(30).lean(),
  ]);
  const history = recentLogs.reverse().map(log => ({
    readingId: String(log._id),
    ...(log.correlationId ? { correlationId: log.correlationId } : {}),
    sequenceNumber: log.sequenceNumber ?? log.simulation?.tick ?? null,
    temperature: log.temperature ?? null,
    humidity: log.humidity ?? null,
    batteryLevel: log.batteryLevel ?? null,
    gpsLat: log.location?.lat ?? null,
    gpsLng: log.location?.lng ?? null,
    vehicleId: log.vehicleId || null,
    deviceId: log.deviceId || log.sensorId || null,
    source: log.source || log.simulation?.telemetrySource || "unknown",
    simulationClock: log.recordedAt || null,
    status: log.evaluation?.batchQuarantined ? "QUARANTINED" : log.evaluation?.severity || log.status || "unknown",
  }));
  const latest = recentLogs.at(-1) || null;
  const alertHistory = recentAlerts.reverse().map(alert => normaliseAlert(alert));
  const simulator = manager.getAllStatuses().filter(status => status.shipmentId === shipmentId)
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  const route = simulator.find(status => Array.isArray(status.route) && status.route.length >= 2)?.route || [];
  const routeCoordinates = route.map(point => ({ latitude: point.latitude, longitude: point.longitude }));
  const totalDistanceKm = routeCoordinates.length >= 2
    ? routeCoordinates.slice(1).reduce((total, point, index) => total + haversineKm(routeCoordinates[index], point), 0)
    : null;
  const active = await SimulatorOverride.findOne({ shipmentId, status: "ACTIVE" }).lean();
  const quarantined = [shipment.coldChainStatus, batch.coldChainStatus].some(value => /quarantin|hold/i.test(String(value || ""))) ||
    Boolean(shipment.coldChainHoldAlertIds?.length || batch.coldChainHoldAlertIds?.length);
  const latestReading = latest ? {
    temperature: latest.temperature ?? null,
    humidity: latest.humidity ?? null,
    batteryLevel: latest.batteryLevel ?? null,
    gpsLat: latest.location?.lat ?? null,
    gpsLng: latest.location?.lng ?? null,
    vehicleId: latest.vehicleId || null,
    deviceId: latest.deviceId || latest.sensorId || null,
    source: latest.source || latest.simulation?.telemetrySource || "unknown",
    timestamp: latest.recordedAt,
    simulationClock: latest.recordedAt,
    status: quarantined ? "QUARANTINED" : latest.status || "unknown",
  } : simulator.find(status => status.lastReading)?.lastReading || null;

  return {
    shipment,
    batch,
    simulator,
    latest,
    init: {
      type: "INIT",
      shipmentId,
      batchId: batch.batchId,
      vaccineType: shipment.vaccineType || batch.vaccineType || null,
      policyLimits: policy ? {
        tempMin: policy.minimumTemperature,
        tempMax: policy.maximumTemperature,
        humidityMin: policy.minimumHumidity ?? null,
        humidityMax: policy.maximumHumidity ?? null,
        criticalBatteryPercent: policy.criticalBatteryPercent,
        approvedAt: policy.approvedAt,
        sourceReference: policy.sourceReference,
      } : { tempMin: null, tempMax: null, humidityMin: null, humidityMax: null },
      routeInfo: {
        origin: shipment.source || null,
        destination: shipment.destination || null,
        totalDistanceKm,
        ...(routeCoordinates.length ? { routeCoordinates,
          originCoordinates: routeCoordinates[0], destinationCoordinates: routeCoordinates.at(-1) } : {}),
      },
      shipmentStatus: shipment.status || null,
      currentState: {
        latestReading,
        readingHistory: history,
        alerts: alertHistory,
        progress: statusProgress(shipment),
        status: quarantined ? "QUARANTINED" : latest?.status || shipment.coldChainStatus || "unknown",
        shipmentStatus: shipment.status || null,
        simulationClock: latest?.recordedAt || null,
        activeOverride: safeOverride(active),
      },
    },
  };
}

function toReadingMessage(shipmentId, reading, details = {}) {
  const recordedAt = reading.simulationClock || reading.recordedAt || reading.timestamp || null;
  const location = reading.location || {};
  return {
    type: "READING",
    ...(reading.correlationId ? { correlationId: reading.correlationId } : {}),
    shipmentId,
    readingId: reading.readingId || (reading._id ? String(reading._id) : null),
    sequenceNumber: reading.sequenceNumber ?? reading.simulation?.tick ?? null,
    batchId: reading.batchId || details.batchId || null,
    deviceId: reading.deviceId || reading.sensorId || null,
    vehicleId: reading.vehicleId || null,
    temperature: reading.temperature ?? null,
    humidity: reading.humidity ?? null,
    battery: reading.battery ?? reading.batteryLevel ?? null,
    gpsLat: reading.gpsLat ?? reading.latitude ?? location.lat ?? null,
    gpsLng: reading.gpsLng ?? reading.longitude ?? location.lng ?? null,
    source: reading.source || reading.simulation?.telemetrySource || "unknown",
    simulationClock: recordedAt,
    alertsTriggered: Array.isArray(details.alertsTriggered) ? details.alertsTriggered : [],
    ...(Number.isFinite(Number(details.progress)) ? { progress: Number(details.progress) } : {}),
    ...(details.status ? { status: details.status } : {}),
    ...(Object.prototype.hasOwnProperty.call(details, "activeOverride") ? { activeOverride: safeOverride(details.activeOverride) } : {}),
  };
}

function mapPresetName(name) {
  const key = String(name || "").trim().toLowerCase();
  return ({
    "refrigeration fault": "refrigeration-failure",
    "door left open": "door-left-open",
    "freezing risk": "freezing-risk",
    "low humidity event": "low-humidity",
  })[key] || null;
}

function attachFieldOperatorWebSocket(server, { manager, WebSocketServerClass = WebSocketServer } = {}) {
  const simulatorManager = manager || require("../controllers/simulatorController").simulatorManager;
  const wss = new WebSocketServerClass({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(PROTOCOL) ? PROTOCOL : false });
  const clientsByShipment = new Map();
  const sessions = new Map();
  const graceMs = disconnectGraceMs();
  let closing = false;

  const sendJson = (ws, payload) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(payload)); return true; } catch (_) { return false; }
  };
  const broadcast = (shipmentId, payload) => {
    const clients = clientsByShipment.get(shipmentId);
    if (!clients) return 0;
    let sent = 0;
    for (const ws of clients) if (sendJson(ws, payload)) sent += 1;
    return sent;
  };

  function clearGrace(session) {
    if (session.graceTimer) clearInterval(session.graceTimer);
    session.graceTimer = null;
    session.releaseAt = null;
  }

  async function simulationTime(shipmentId) {
    try { return new Date(simulatorManager.getShipmentTimeline(shipmentId).eventTime); }
    catch (_) { return null; }
  }

  async function beginDisconnectGrace(session) {
    if (session.sockets.size || closing) return;
    clearGrace(session);
    const clock = await simulationTime(session.shipmentId);
    if (session.sockets.size || closing) return;
    if (!clock || !session.ownedOverrideIds.size) { sessions.delete(session.key); return; }
    session.releaseAt = new Date(+clock + graceMs);
    session.graceTimer = setInterval(async () => {
      if (session.sockets.size) return clearGrace(session);
      const now = await simulationTime(session.shipmentId);
      if (session.sockets.size) return clearGrace(session);
      if (!now || +now < +session.releaseAt) return;
      clearGrace(session);
      const ids = [...session.ownedOverrideIds];
      session.ownedOverrideIds.clear();
      for (const overrideId of ids) {
        const override = await SimulatorOverride.findOne({ overrideId, shipmentId: session.shipmentId, status: "ACTIVE" });
        if (!override || String(override.createdBy) !== session.actorId) continue;
        try {
          await releaseOverride({ overrideId, actorId: "SYSTEM", reason: "Field operator disconnected; simulated-time grace period elapsed.", manager: simulatorManager });
          const latestStatus = await Shipment.findOne({ shipmentId: session.shipmentId }).select("status").lean();
          broadcast(session.shipmentId, { type: "STATUS_CHANGE", newStatus: latestStatus?.status || "override-released",
            reason: "Manual simulator override released after the field operator disconnect grace period.", simulationClock: now.toISOString(), activeOverride: null });
        } catch (_) { /* An expired/released override needs no second release. */ }
      }
      sessions.delete(session.key);
    }, Math.min(GRACE_POLL_MS, Math.max(50, graceMs)));
    session.graceTimer.unref?.();
  }

  async function verifyConnectionContext(context) {
    const user = await verifyAccessToken(context.token);
    const shipment = await Shipment.findOne({ shipmentId: context.shipmentId }).lean();
    if (!shipment) throw new Error("Shipment unavailable");
    const batch = await Batch.findOne({ batchId: shipment.batchId }).lean();
    if (!batch || !canReadShipment(user, shipment, batch) || shipment.batchId !== context.batchId) throw new Error("Shipment access changed");
    context.user = user;
    return { user, shipment, batch };
  }

  async function handleCommand(ws, command) {
    const context = ws.operatorContext;
    const { user } = await verifyConnectionContext(context);
    if (!command || typeof command !== "object" || Array.isArray(command) || typeof command.type !== "string") throw new Error("Command must be a JSON object with a type");
    const requestId = typeof command.requestId === "string" && command.requestId.length <= 120 ? command.requestId : undefined;
    const respond = result => sendJson(ws, { type: "OVERRIDE_RESULT", ...(requestId ? { requestId } : {}), ...result });

    if (["OVERRIDE", "RELEASE_OVERRIDE"].includes(command.type)) {
      if (user.role !== "admin") return respond({ command: command.type, status: "rejected", message: "Manual simulator overrides require the admin role." });
      if (process.env.SIMULATOR_MANUAL_OVERRIDES_ENABLED !== "true") return respond({ command: command.type, status: "rejected", message: "Manual simulator overrides are disabled by backend configuration." });
      if (command.shipmentId && command.shipmentId !== context.shipmentId) return respond({ command: command.type, status: "rejected", message: "This connection is scoped to a different shipment." });

      if (command.type === "OVERRIDE") {
        const durationMinutes = Number(command.durationMinutes ?? command.holdDuration ?? 10);
        const rampDuration = Number(command.rampDuration ?? 0);
        if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 120 ||
            !Number.isFinite(rampDuration) || rampDuration < 0 || rampDuration > 60 || durationMinutes + rampDuration > 120) {
          return respond({ command: command.type, status: "rejected", message: "Override and ramp duration must total at most 120 simulated minutes." });
        }
        const presetId = mapPresetName(command.presetName);
        const input = {
          shipmentId: context.shipmentId,
          ...(presetId ? { presetId } : {}),
          ...(Object.prototype.hasOwnProperty.call(command, "temperature") ? { targetTemperature: command.temperature } : {}),
          ...(Object.prototype.hasOwnProperty.call(command, "humidity") ? { targetHumidity: command.humidity } : {}),
          behavior: command.behavior || "hold",
          rampDuration,
          holdDuration: durationMinutes,
          expiresInMs: command.expiresInMs === undefined ? (durationMinutes + rampDuration) * 60_000 : Number(command.expiresInMs),
          reason: typeof command.reason === "string" ? command.reason : `Field operator synthetic override${command.presetName ? `: ${String(command.presetName).slice(0, 100)}` : ""}`,
        };
        if (!Number.isSafeInteger(input.expiresInMs) || input.expiresInMs > 120 * 60_000 || input.expiresInMs > HARD_MAX_TTL_MS || input.expiresInMs < (durationMinutes + rampDuration) * 60_000) {
          return respond({ command: command.type, status: "rejected", message: "Override expiry must cover its duration and stay within the 120-minute demo cap." });
        }
        if (ws.readyState !== WebSocket.OPEN) return;
        const override = await createOverride({ input, actorId: user.id, manager: simulatorManager });
        context.session.ownedOverrideIds.add(override.overrideId);
        if (ws.readyState !== WebSocket.OPEN && !context.session.sockets.size && !closing) {
          sessions.set(context.session.key, context.session);
          beginDisconnectGrace(context.session).catch(() => sessions.delete(context.session.key));
        }
        return respond({ command: command.type, status: "accepted", message: "Synthetic override applied to the shipment simulator.", activeOverride: safeOverride(override) });
      }

      const active = await SimulatorOverride.findOne({ shipmentId: context.shipmentId, status: "ACTIVE" }).lean();
      if (!active) return respond({ command: command.type, status: "accepted", message: "No active simulator override remains.", activeOverride: null });
      const override = await releaseOverride({ overrideId: active.overrideId, actorId: user.id,
        reason: typeof command.reason === "string" ? command.reason : "Field operator returned the simulator to automatic mode.", manager: simulatorManager });
      context.session.ownedOverrideIds.delete(active.overrideId);
      return respond({ command: command.type, status: "accepted", message: "Simulator override released; automatic readings will resume.", activeOverride: null });
    }

    if (command.type === "GPS_OVERRIDE") return respond({ command: command.type, status: "rejected", message: "Simulated GPS drift is not implemented in this milestone." });
    return respond({ command: command.type, status: "rejected", message: "Unsupported field-operator command." });
  }

  async function onConnection(ws, request) {
    const context = ws.operatorContext;
    try {
      const { shipment, batch } = await verifyConnectionContext(context);
      context.batchId = batch.batchId;
      const key = `${context.user.id}:${context.shipmentId}`;
      let session = sessions.get(key);
      if (!session) {
        session = { key, shipmentId: context.shipmentId, actorId: context.user.id, sockets: new Set(), ownedOverrideIds: new Set(), graceTimer: null, releaseAt: null };
        sessions.set(key, session);
      }
      clearGrace(session);
      session.sockets.add(ws);
      context.session = session;
      const clients = clientsByShipment.get(context.shipmentId) || new Set();
      clients.add(ws);
      clientsByShipment.set(context.shipmentId, clients);

      let authTimer = null;
      ws.once("close", () => {
        if (authTimer) clearInterval(authTimer);
        clients.delete(ws);
        if (!clients.size) clientsByShipment.delete(context.shipmentId);
        session.sockets.delete(ws);
        if (!session.sockets.size) {
          if (closing) { clearGrace(session); sessions.delete(session.key); }
          else beginDisconnectGrace(session).catch(() => sessions.delete(session.key));
        }
      });

      const { init } = await loadShipmentContext(context.shipmentId, context.user, simulatorManager);
      if (ws.readyState !== WebSocket.OPEN) return;
      sendJson(ws, init);

      let messageCount = 0;
      let windowStartedAt = Date.now();
      ws.on("message", raw => {
        if (raw.length > MAX_PAYLOAD) { ws.close(1009, "Message too large"); return; }
        if (Date.now() - windowStartedAt >= 60_000) { windowStartedAt = Date.now(); messageCount = 0; }
        if (++messageCount > COMMANDS_PER_MINUTE) {
          if (!ws.rateLimitNotified) {
            ws.rateLimitNotified = true;
            sendJson(ws, { type: "OVERRIDE_RESULT", status: "rejected", message: "Too many commands; reconnect after waiting a minute." });
            ws.close(1008, "Command rate limit exceeded");
          }
          return;
        }
        let command;
        try { command = JSON.parse(raw.toString()); }
        catch (_) { sendJson(ws, { type: "OVERRIDE_RESULT", status: "rejected", message: "Command must be valid JSON." }); return; }
        handleCommand(ws, command).catch(error => sendJson(ws, { type: "OVERRIDE_RESULT",
          ...(typeof command?.requestId === "string" ? { requestId: command.requestId.slice(0, 120) } : {}),
          command: command?.type || "unknown", status: "rejected", message: error.status && error.status < 500 ? error.message : "The simulator could not apply this command." }));
      });

      authTimer = setInterval(async () => {
        try { await verifyConnectionContext(context); }
        catch (_) { ws.close(1008, "Session or shipment access is no longer valid"); }
      }, AUTH_RECHECK_MS);
      authTimer.unref?.();
    } catch (error) {
      ws.close(error.status === 404 ? 1008 : 1011, "Shipment could not be authorized");
    }
  }

  async function onUpgrade(request, socket, head) {
    let url;
    try { url = new URL(request.url, "http://localhost"); }
    catch (_) { rejectUpgrade(socket, 400, "Malformed WebSocket URL"); return; }
    if (url.pathname !== ENDPOINT) {
      // The role-dashboard gateway owns this independent channel on the same
      // HTTP server; leave its upgrade for the next registered listener.
      if (url.pathname === "/ws/dashboard") return;
      if (url.pathname.startsWith("/ws/")) rejectUpgrade(socket, 404, "WebSocket endpoint not found");
      return;
    }
    const origin = request.headers.origin;
    if (origin && !allowedOrigins().has(origin)) { rejectUpgrade(socket, 403, "Origin is not allowed"); return; }
    const protocols = parseProtocols(request);
    if (!protocols.includes(PROTOCOL)) { rejectUpgrade(socket, 400, "Required WebSocket protocol is missing"); return; }
    const token = readBearerProtocol(protocols);
    const shipmentId = (url.searchParams.get("shipmentId") || "").trim();
    if (!token || !shipmentId || shipmentId.length > 120 || url.searchParams.getAll("shipmentId").length !== 1) {
      rejectUpgrade(socket, 401, "Authentication or shipment selection is required"); return;
    }
    let user;
    try { user = await verifyAccessToken(token); }
    catch (_) { rejectUpgrade(socket, 401, "Invalid or expired credentials"); return; }
    try {
      await simulatorManager.initialize();
      const shipment = await Shipment.findOne({ shipmentId }).select("shipmentId batchId").lean();
      const batch = shipment ? await Batch.findOne({ batchId: shipment.batchId }).lean() : null;
      if (!shipment || !batch || !canReadShipment(user, shipment, batch)) { rejectUpgrade(socket, 404, "Shipment is unavailable"); return; }
      wss.handleUpgrade(request, socket, head, ws => {
        ws.operatorContext = { token, user, shipmentId, batchId: batch.batchId, openedAt: Date.now() };
        wss.emit("connection", ws, request);
      });
    } catch (_) { rejectUpgrade(socket, 503, "Shipment access could not be verified"); }
  }

  server.on("upgrade", onUpgrade);
  wss.on("connection", onConnection);

  const publishReading = async (shipmentId, reading, details = {}) => {
    if (!clientsByShipment.has(shipmentId)) return 0;
    if (!reading || typeof reading !== "object" || (reading.shipmentId && reading.shipmentId !== shipmentId)) return 0;
    const shipment = await Shipment.findOne({ shipmentId }).select("batchId status statusHistory hospitalConfirmed coldChainStatus coldChainHoldAlertIds").lean();
    const log = details.persistedLog || (reading?._id ? reading : null);
    const alertsTriggered = Array.isArray(details.alertsTriggered) ? [...details.alertsTriggered] : [];
    if (!alertsTriggered.length && log?.evaluation?.alertIds?.length) {
      const alerts = await TemperatureAlert.find({ alertId: { $in: log.evaluation.alertIds }, shipmentId }).lean();
      alertsTriggered.push(...alerts.map(alert => alert.alertId));
    }
    const activeOverride = await SimulatorOverride.findOne({ shipmentId, status: "ACTIVE" }).lean();
    const quarantined = Boolean(log?.evaluation?.batchQuarantined) ||
      [shipment?.coldChainStatus].some(value => /quarantin|hold/i.test(String(value || ""))) ||
      Boolean(shipment?.coldChainHoldAlertIds?.length);
    const sent = broadcast(shipmentId, toReadingMessage(shipmentId, reading, {
      batchId: shipment?.batchId,
      progress: shipment ? statusProgress(shipment) : null,
      status: quarantined ? "QUARANTINED" : log?.status || details.status,
      alertsTriggered,
      activeOverride,
    }));
    logger.info("websocket.telemetry.broadcast", { correlationId: reading.correlationId, shipmentId,
      subscriberCount: sent });
    return sent;
  };
  const publishAlert = alert => {
    const sent = broadcast(alert.shipmentId, normaliseAlert(alert));
    logger.info("websocket.alert.broadcast", { correlationId: alert.correlationId, shipmentId: alert.shipmentId,
      alertId: alert.alertId, subscriberCount: sent });
    return sent;
  };
  const publishStatusChange = (shipmentId, event = {}) => broadcast(shipmentId, {
    type: "STATUS_CHANGE",
    newStatus: event.newStatus || event.status || "unknown",
    reason: event.reason || "Shipment status changed.",
    simulationClock: event.simulationClock || event.timestamp || new Date().toISOString(),
    ...(Object.prototype.hasOwnProperty.call(event, "activeOverride") ? { activeOverride: safeOverride(event.activeOverride) } : {}),
  });

  async function close() {
    closing = true;
    server.off("upgrade", onUpgrade);
    for (const session of sessions.values()) clearGrace(session);
    sessions.clear();
    for (const ws of wss.clients) ws.close(1001, "Server shutting down");
    await new Promise(resolve => wss.close(() => resolve()));
    fieldOperatorEvents.unregisterPublisher(api);
  }

  const api = { wss, close, broadcast, publishReading, publishAlert, publishStatusChange,
    endpoint: ENDPOINT, protocol: PROTOCOL, graceMs };
  fieldOperatorEvents.registerPublisher(api);
  return api;
}

module.exports = { attachFieldOperatorWebSocket, ENDPOINT, PROTOCOL, disconnectGraceMs,
  statusProgress, canReadShipment, toReadingMessage, normaliseAlert };
