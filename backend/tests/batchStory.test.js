jest.mock("../services/blockchainService", () => ({
  getBatchLifecycleFromChain: jest.fn().mockResolvedValue({
    batchId: "TEST-1",
    lifecycle: [{ batchId: "TEST-1", actorRole: "Manufacturer", action: "Batch Registered", location: "Warehouse", details: "Synthetic vaccine", quantity: 100, timestamp: 1767225600, actor: "0xLOCAL" }],
  }),
  registerBatchOnChain: jest.fn(), getBatchFromChain: jest.fn(), extractHash: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const User = require("../models/user");
const Batch = require("../models/Batch");
const TemperatureLog = require("../models/TemperatureLog");
const Alert = require("../models/TemperatureAlert");
const Audit = require("../models/ColdChainAudit");
const InventoryCertificate = require("../models/InventoryCertificate");
const { issueToken } = require("../middleware/auth");
const { connect, close, fixture } = require("./helpers/coldChainFixture");

const app = express();
app.use(express.json());
app.use("/api/batches", require("../routes/batchRoutes"));
const bearer = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });
let f, admin, maker, hospital, distributor;

beforeAll(connect, 15000);
afterAll(close);
beforeEach(async () => {
  f = await fixture();
  [admin, maker, hospital, distributor] = await User.create([
    { email: `${f.batchId}-admin@test`, role: "admin" },
    { email: `${f.batchId}-maker@test`, role: "manufacturer", manufacturer: "maker-a" },
    { email: `${f.batchId}-hospital@test`, role: "healthcare", hospital: "hospital-a" },
    { email: `${f.batchId}-dist@test`, role: "distributor", distributor: "dist-a" },
  ]);
});

test("read-only batch story assembles full telemetry, policy and quarantine history, shipment transitions, chain refs and forecast context", async () => {
  await Batch.updateOne({ batchId: f.batchId }, { $set: { txHash: `0x${"1".repeat(64)}`, baselineDemandForecast: 48, productionApprovedAt: f.at(1), productionSigner: "Maker QA" } });
  await InventoryCertificate.create({ certificateId: `CERT-${f.batchId}`, batchId: f.batchId, predictedDemand: 48, issuedAt: f.at(1), txHash: `0x${"2".repeat(64)}`, sourceSeries: [8, 12, 20] });
  await TemperatureLog.create([
    { batchId: f.batchId, shipmentId: f.shipmentId, temperature: 5, humidity: 55, batteryLevel: 90, recordedAt: f.at(1), deviceId: "SENSOR-1",
      evaluation: { evaluated: true, policyStatus: "APPROVED", violationType: "NORMAL", severity: "NORMAL", recommendedAction: "RECORD_NORMAL" } },
    { batchId: f.batchId, shipmentId: f.shipmentId, temperature: 9, humidity: 54, batteryLevel: 89, recordedAt: f.at(2), deviceId: "SENSOR-1",
      evaluation: { evaluated: true, policyStatus: "APPROVED", violationType: "HIGH_TEMPERATURE", severity: "CRITICAL", reasons: ["Synthetic high excursion"], recommendedAction: "QUARANTINE_PENDING_REVIEW",
        anomalyInference: { status: "ANOMALY", model: "rolling_median_mad_v1", advisory_only: true, reason: "9°C exceeded the prior baseline." } } },
  ]);
  await Alert.create({ alertId: `ALERT-${f.batchId}`, batchId: f.batchId, shipmentId: f.shipmentId, deviceId: "SENSOR-1", currentTemperature: 9,
    minimumAllowedTemperature: 2, maximumAllowedTemperature: 8, violationType: "HIGH_TEMPERATURE", severity: "CRITICAL", reason: "Synthetic excursion",
    timestamp: f.at(2), excursionStartedAt: f.at(2), latestReadingAt: f.at(2), phase: "QUARANTINED", requiresQualityReview: true,
    reasons: ["Temperature above approved limit"], recommendedAction: "Request quality review", policySnapshot: { maximumTemperature: 8 } });
  await Audit.create({ batchId: f.batchId, alertId: `ALERT-${f.batchId}`, action: "QUARANTINE_AUTHORIZED", actorId: String(admin._id), reason: "Synthetic test excursion", eventTime: f.at(2) });
  await Batch.updateOne({ batchId: f.batchId }, { $set: { "disposition.status": "discarded", "disposition.reasonCode": "DEMO_TEST", "disposition.reason": "Synthetic fixture", "disposition.recordedAt": f.at(3), "disposition.recordedBy": admin._id, "disposition.recordedByRole": "admin" } });
  await require("../models/Shipment").updateOne({ shipmentId: f.shipmentId }, { $set: { statusHistory: [
    { status: "Prepared", timestamp: f.at(1), txHash: `0x${"3".repeat(64)}` }, { status: "In Transit", timestamp: f.at(2) },
  ] } });

  const response = await request(app).get(`/api/batches/${f.batchId}/story`).set(bearer(admin));
  expect(response.status).toBe(200);
  expect(response.body.readings.map(reading => reading.temperature)).toEqual([5, 9]);
  expect(response.body.alerts[0]).toMatchObject({ phase: "QUARANTINED", recommendedAction: "Request quality review", reasons: ["Temperature above approved limit"] });
  expect(response.body.events.map(event => event.kind)).toEqual(expect.arrayContaining(["shipment", "telemetry", "evaluation", "alert", "audit", "disposition", "blockchain"]));
  expect(response.body.events.find(event => event.kind === "evaluation")).toMatchObject({ evaluation: { severity: "NORMAL", recommendedAction: "RECORD_NORMAL" } });
  expect(response.body.events.find(event => event.kind === "ai_inference")).toMatchObject({
    actor: "Rolling median/MAD statistical detector",
    anomalyInference: { status: "ANOMALY", advisory_only: true, reason: "9°C exceeded the prior baseline." },
  });
  expect(response.body.readings.find(reading => reading.temperature === 9).evaluation.anomalyInference.status).toBe("ANOMALY");
  expect(response.body.batch.disposition).toMatchObject({ status: "discarded", reasonCode: "DEMO_TEST" });
  expect(response.body.blockchain.status).toBe("available");
  expect(response.body.blockchain.references.map(item => item.txHash)).toEqual(expect.arrayContaining([`0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`]));
  expect(response.body.forecast).toMatchObject({ source: "Inventory certificate", predictedDemand: 48, certificateId: `CERT-${f.batchId}` });
});

test("hospital story is limited to the assigned batch and hides manufacturer production and forecast internals", async () => {
  await Batch.updateOne({ batchId: f.batchId }, { $set: { productionApproved: true, productionSigner: "Private manufacturer signer", baselineDemandForecast: 100 } });
  await InventoryCertificate.create({ certificateId: `CERT-${f.batchId}`, batchId: f.batchId, predictedDemand: 100, sourceSeries: [20, 30] });
  await TemperatureLog.create({ batchId: f.batchId, shipmentId: f.shipmentId, temperature: 5, recordedAt: f.at(1), deviceId: "VISIBLE-SENSOR" });
  await TemperatureLog.create({ batchId: f.batchId, shipmentId: "OUTSIDE-SHIPMENT", temperature: 99, recordedAt: f.at(2), deviceId: "PRIVATE-SENSOR" });

  const response = await request(app).get(`/api/batches/${f.batchId}/story`).set(bearer(hospital));
  expect(response.status).toBe(200);
  expect(response.body.readings.map(reading => reading.deviceId)).toEqual(["VISIBLE-SENSOR"]);
  expect(response.body.batch.manufacturer).toBe("maker-a");
  expect(response.body.batch).not.toHaveProperty("productionSigner");
  expect(response.body).not.toHaveProperty("forecast");
  expect(response.body.blockchain.lifecycle).toEqual([]);
  expect(response.body.blockchain.status).toBe("scoped");
});

test("batch story remains authenticated and respects manufacturer, distributor and hospital scope", async () => {
  expect((await request(app).get(`/api/batches/${f.batchId}/story`)).status).toBe(401);
  expect((await request(app).get(`/api/batches/${f.batchId}/story`).set(bearer(maker))).status).toBe(200);
  expect((await request(app).get(`/api/batches/${f.batchId}/story`).set(bearer(distributor))).status).toBe(200);
  const otherMaker = await User.create({ email: `${f.batchId}-other@test`, role: "manufacturer", manufacturer: "maker-b" });
  expect((await request(app).get(`/api/batches/${f.batchId}/story`).set(bearer(otherMaker))).status).toBe(404);
  const otherDistributor = await User.create({ email: `${f.batchId}-otherdist@test`, role: "distributor", distributor: "dist-b" });
  expect((await request(app).get(`/api/batches/${f.batchId}/story`).set(bearer(otherDistributor))).status).toBe(404);
});
