jest.mock("../services/telemetryService", () => ({
  persistSimulationReading: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const { persistSimulationReading } = require("../services/telemetryService");
const { simulatorManager } = require("../controllers/simulatorController");
const simulatorRoutes = require("../routes/simulatorRoutes");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const { issueToken } = require("../middleware/auth");
let auth;

const app = express();
app.use(express.json());
app.use("/api/simulator", simulatorRoutes);

const device = {
  deviceId: "IOT-ROUTE-001",
  vehicleId: "TRUCK-01",
  batchId: "VAC-001",
  shipmentId: "SHIP-001",
  scenario: "NORMAL",
  seed: "route-test",
  startTime: "2026-09-17T10:30:00.000Z",
  tickIntervalMs: 60000,
  route: [
    { latitude: 9.9312, longitude: 76.2673 },
    { latitude: 9.9412, longitude: 76.2773 },
  ],
};

describe("simulator routes", () => {
  beforeAll(async () => {
    await connect();
    const f = await fixture();
    device.batchId = f.batchId;
    device.shipmentId = f.shipmentId;
    auth = { Authorization: `Bearer ${issueToken({ id: f.reviewer._id, role: "admin" })}` };
  }, 15000);

  beforeEach(async () => {
    simulatorManager.clear();
    await require("../models/SimulatorDevice").deleteMany({});
    persistSimulationReading.mockResolvedValue({ _id: "telemetry-1" });
  });

  afterAll(async () => {
    simulatorManager.clear();
    await close();
  });

  test("supports device lifecycle controls and status inspection", async () => {
    const created = await request(app).post("/api/simulator/devices").set(auth).send(device);
    expect(created.status).toBe(201);
    expect(created.body.simulation.deviceId).toBe(device.deviceId);

    const ticked = await request(app).post(`/api/simulator/${device.deviceId}/tick`).set(auth);
    expect(ticked.status).toBe(200);
    expect(ticked.body.reading.timestamp).toBe(device.startTime);
    expect(persistSimulationReading).toHaveBeenCalledTimes(1);

    const started = await request(app).post(`/api/simulator/${device.deviceId}/start`).set(auth);
    expect(started.body.simulation.running).toBe(true);

    const status = await request(app).get(`/api/simulator/${device.deviceId}/status`).set(auth);
    expect(status.body.simulation.ticksGenerated).toBe(1);
    expect(status.body.simulation.running).toBe(true);

    const stopped = await request(app).post(`/api/simulator/${device.deviceId}/stop`).set(auth);
    expect(stopped.body.simulation.running).toBe(false);

    const changed = await request(app).post(`/api/simulator/${device.deviceId}/scenario`).set(auth).send({ scenario: "HIGH_TEMPERATURE" });
    expect(changed.body.simulation.scenario).toBe("HIGH_TEMPERATURE");
    expect(changed.body.simulation.ticksGenerated).toBe(1);

    const reset = await request(app).post(`/api/simulator/${device.deviceId}/reset`).set(auth);
    expect(reset.body.simulation.ticksGenerated).toBe(0);

    const all = await request(app).get("/api/simulator/status").set(auth);
    expect(all.body.simulations).toHaveLength(1);
  });

  test("requires real identity, valid batch/shipment links, and unique device IDs", async () => {
    process.env.AUTH_OPTIONAL = "true";
    try { expect((await request(app).post("/api/simulator/devices").send(device)).status).toBe(401); }
    finally { delete process.env.AUTH_OPTIONAL; }
    expect((await request(app).post("/api/simulator/devices").set(auth).send({ ...device, shipmentId: "not-real" })).status).toBe(400);
    expect((await request(app).post("/api/simulator/devices").set(auth).send(device)).status).toBe(201);
    expect((await request(app).post("/api/simulator/devices").set(auth).send(device)).status).toBe(409);
  });
});
