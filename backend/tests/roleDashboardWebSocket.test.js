const http = require("node:http");
const express = require("express");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const { issueToken } = require("../middleware/auth");
const User = require("../models/user");
const { attachRoleDashboardWebSocket, PROTOCOL } = require("../services/roleDashboardWebSocket");
const { attachFieldOperatorWebSocket } = require("../services/fieldOperatorWebSocket");
const events = require("../services/dashboardEventBus");

let server, service, fieldService, data, sockets = [];
const previousOrigins = process.env.DASHBOARD_WS_ALLOWED_ORIGINS;
function waitMessage(socket, type, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
    socket.on("message", raw => {
      let value; try { value = JSON.parse(raw.toString()); } catch (_) { return; }
      if (value.type === type) { clearTimeout(timeout); resolve(value); }
    });
  });
}
async function openSocket(port, user) {
  const token = issueToken({ id: user._id, role: user.role, tokenVersion: user.tokenVersion || 0 });
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/dashboard`, [PROTOCOL, `bearer.${token}`], { headers: { Origin: "http://127.0.0.1:5173" } });
  const ready = waitMessage(socket, "READY");
  sockets.push(socket);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  await ready;
  return socket;
}

beforeAll(async () => connect());
afterAll(async () => { if (previousOrigins === undefined) delete process.env.DASHBOARD_WS_ALLOWED_ORIGINS; else process.env.DASHBOARD_WS_ALLOWED_ORIGINS = previousOrigins; await close(); });
beforeEach(async () => {
  process.env.DASHBOARD_WS_ALLOWED_ORIGINS = "http://127.0.0.1:5173";
  data = await fixture();
  const manufacturer = await User.create({ email: `maker-${Date.now()}@example.test`, role: "manufacturer", manufacturer: "maker-a" });
  const distributor = await User.create({ email: `dist-${Date.now()}@example.test`, role: "distributor", distributor: "dist-a" });
  const healthcare = await User.create({ email: `hospital-${Date.now()}@example.test`, role: "healthcare", hospital: "hospital-a" });
  server = http.createServer(express());
  fieldService = attachFieldOperatorWebSocket(server);
  service = attachRoleDashboardWebSocket(server, { heartbeatMs: 30000 });
  const port = await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  sockets = [];
  global.wsUsers = { port, admin: data.reviewer, manufacturer, distributor, healthcare, extraUserIds: [manufacturer._id, distributor._id, healthcare._id] };
});
afterEach(async () => {
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.close();
  await Promise.all(sockets.map(socket => new Promise(resolve => { if (socket.readyState === WebSocket.CLOSED) resolve(); else { socket.once("close", resolve); setTimeout(resolve, 200); } })));
  if (service) await service.close(); service = null;
  if (fieldService) await fieldService.close(); fieldService = null;
  if (server?.listening) await new Promise(resolve => server.close(resolve)); server = null;
  await User.deleteMany({ _id: { $in: global.wsUsers?.extraUserIds || [] } });
  if (mongoose.connection.readyState === 1) {
    await require("../models/Shipment").deleteMany({ shipmentId: data.shipmentId });
    await require("../models/Batch").deleteMany({ batchId: data.batchId });
    await User.deleteMany({ _id: data.reviewer._id });
  }
});

test("role-scoped dashboards receive shipment events through the shared publisher in under one second", async () => {
  const { port, admin, distributor, healthcare } = global.wsUsers;
  const adminSocket = await openSocket(port, admin);
  const distSocket = await openSocket(port, distributor);
  const healthcareSocket = await openSocket(port, healthcare);
  const adminReading = waitMessage(adminSocket, "READING");
  const distReading = waitMessage(distSocket, "READING");
  const healthcareReading = waitMessage(healthcareSocket, "READING");
  const start = Date.now();
  await events.publishReading({ batchId: data.batchId, shipmentId: data.shipmentId, temperature: 5.2, humidity: 58,
    vehicleId: "SYNTH-TRUCK", recordedAt: new Date().toISOString(), location: { lat: 9.9, lng: 76.3 } });
  const [adminEvent, distEvent, hospitalEvent] = await Promise.all([adminReading, distReading, healthcareReading]);
  expect(Date.now() - start).toBeLessThan(1000);
  expect(adminEvent.data.temperature).toBe(5.2);
  expect(distEvent.data.shipmentId).toBe(data.shipmentId);
  expect(hospitalEvent.data.batchId).toBe(data.batchId);
});

test("alert, position, workflow, notification and anchoring events reach the matching role channels", async () => {
  const { port, admin, distributor, healthcare } = global.wsUsers;
  const adminSocket = await openSocket(port, admin), distSocket = await openSocket(port, distributor), hospitalSocket = await openSocket(port, healthcare);
  const alertWait = [waitMessage(adminSocket, "ALERT_OPENED"), waitMessage(distSocket, "ALERT_OPENED"), waitMessage(hospitalSocket, "ALERT_OPENED")];
  await events.publishAlert({ alertId: "ALERT-SYNTH-1", batchId: data.batchId, shipmentId: data.shipmentId,
    currentTemperature: 9, minimumAllowedTemperature: 2, maximumAllowedTemperature: 8, reason: "Synthetic test excursion" }, "OPENED");
  expect((await Promise.all(alertWait)).every(event => event.data.policyReason === "Synthetic test excursion")).toBe(true);

  const positionWait = [waitMessage(adminSocket, "SHIPMENT_POSITION"), waitMessage(distSocket, "SHIPMENT_POSITION"), waitMessage(hospitalSocket, "SHIPMENT_POSITION")];
  await events.publishPosition({ batchId: data.batchId, shipmentId: data.shipmentId, vehicleId: "TRUCK-SYNTH", location: { lat: 9, lng: 76 }, recordedAt: new Date() });
  expect((await Promise.all(positionWait))[1].data.latitude).toBe(9);

  const workflowWait = waitMessage(distSocket, "SHIPMENT_UPDATED");
  await events.publishShipmentStatus({ shipmentId: data.shipmentId, batchId: data.batchId, status: "In Transit" }, "Synthetic test transition");
  expect((await workflowWait).data.status).toBe("In Transit");

  const notificationWait = waitMessage(distSocket, "NOTIFICATION");
  await events.publishNotification({ recipientRole: "distributor", recipientRefKey: "dist-a", title: "Synthetic notification", message: "Test only", metadata: { shipmentId: data.shipmentId } });
  expect((await notificationWait).data.title).toBe("Synthetic notification");

  const anchorWait = [waitMessage(adminSocket, "ANCHORING_STATUS"), waitMessage(distSocket, "ANCHORING_STATUS"), waitMessage(hospitalSocket, "ANCHORING_STATUS")];
  await events.publishAnchoring({ batchId: data.batchId, windowId: "WINDOW-SYNTH", windowStart: new Date(), windowEnd: new Date(), count: 2, status: "confirmed" }, [data.shipmentId]);
  expect((await Promise.all(anchorWait))[0].data.status).toBe("confirmed");
});
