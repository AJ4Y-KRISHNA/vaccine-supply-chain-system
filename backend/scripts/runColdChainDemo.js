// Explicit local-only demonstration. Keeps its labeled records for dashboard inspection.
// Never reseeds/deletes data, changes passwords, or calls blockchain/forecast services.
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");

async function main() {
  if (!process.argv.includes("--execute")) throw new Error("Review this script, then run: node scripts/runColdChainDemo.js --execute");
  const uri = process.env.MONGO_URI;
  if (!uri || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(uri).hostname)) throw new Error("This demo only writes to a configured local MongoDB database");
  // Fresh in-memory secrets for this temporary loopback server; no .env edits or token output.
  process.env.JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString("hex");
  process.env.REFRESH_SECRET = process.env.REFRESH_SECRET || randomBytes(32).toString("hex");
  process.env.NODE_ENV = "test"; // server.js exports the actual app without opening its default listener.
  const blockedCalls = [];
  // Fail rather than initiate an external service call if an operational guard regresses.
  for (const name of ["blockchainService", "aiService"]) {
    const service = require(`../services/${name}`);
    for (const [key, value] of Object.entries(service)) if (typeof value === "function") {
      service[key] = () => { blockedCalls.push(`${name}.${key}`); throw new Error("External service calls are disabled for the synthetic demo"); };
    }
  }
  const app = require("../server");
  const User = require("../models/user");
  const Batch = require("../models/Batch");
  const Shipment = require("../models/Shipment");
  const Alert = require("../models/TemperatureAlert");
  const Audit = require("../models/ColdChainAudit");
  const Notification = require("../models/Notification");
  const TemperatureLog = require("../models/TemperatureLog");
  const Vaccination = require("../models/Vaccination");
  const { simulatorManager } = require("../controllers/simulatorController");
  await mongoose.connection.asPromise();
  await Promise.all([Alert.init(), Notification.init(), require("../models/TelemetryState").init()]);
  const accounts = {
    admin: { email: "admin@test.com", role: "admin" },
    manufacturer: { email: "manufacturer@test.com", role: "manufacturer", field: "manufacturer", organization: "DEMO Cold-Chain Manufacturer" },
    distributor: { email: "distributor@test.com", role: "distributor", field: "distributor", organization: "DEMO Cold-Chain Distributor" },
    hospital: { email: "hospital@test.com", role: "healthcare", field: "hospital", organization: "DEMO Cold-Chain Hospital" },
  };
  // Complete preflight before any writes; existing non-demo mappings must never be overwritten.
  for (const account of Object.values(accounts)) {
    const found = await User.find({ email: account.email, role: account.role });
    assert.equal(found.length, 1, `Expected exactly one seeded ${account.role} account`);
    account.user = found[0];
    if (account.field && account.user[account.field] && account.user[account.field] !== account.organization) throw new Error(`${account.email} already has a different organization mapping; no mappings changed`);
  }
  assert.equal(accounts.admin.user.canReviewColdChain, true, "Designate admin@test.com using setColdChainReviewer.js first");
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(method, route, account, body, expected = 200) {
    const response = await fetch(`${base}${route}`, { method, headers: {
      "Content-Type": "application/json", ...(account?.token ? { Authorization: `Bearer ${account.token}` } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${response.status}; ${JSON.stringify(data.error || data.message || "Unexpected status")}`);
    return data;
  }
  try {
    // Authenticate using existing seeded credentials; never change or print passwords/tokens.
    for (const account of Object.values(accounts)) {
      const login = await call("POST", "/auth/login", null, { email: account.email, role: account.role, password: process.env.DEMO_ACCOUNT_PASSWORD || "123456" });
      account.token = login.token;
    }
    const existingBatches = await Batch.find().sort({ _id: 1 }).lean();
    const existingShipments = await Shipment.find().sort({ _id: 1 }).lean();
    for (const account of Object.values(accounts).filter(a => a.field)) {
      if (account.user[account.field] === account.organization) continue;
      await Audit.create({ batchId: "__access_control__", action: "DEMO_IDENTITY_MAPPING_AUTHORIZED", actorId: String(accounts.admin.user._id), eventTime: new Date(),
        reason: "User-authorized automated synthetic demo setup; no operational organization mapping is inferred.",
        snapshot: { userId: account.user._id, email: account.email, field: account.field, before: account.user[account.field] || null, after: account.organization } });
      account.user[account.field] = account.organization;
      await account.user.save();
    }
    const suffix = `${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const batchId = `DEMO-CC-${suffix}`;
    const shipmentId = `DEMO-SHIP-${suffix}`;
    const deviceId = `DEMO-IOT-${suffix}`;
    // Seed only this synthetic specimen directly: real batch creation would invoke blockchain workflows.
    const batch = await Batch.create({ batchId, vaccineType: "SYNTHETIC DEMO ONLY — NOT FOR CLINICAL USE", quantity: 0,
      manufacturer: accounts.manufacturer.organization, status: "Demo only — no clinical inventory" });
    await Audit.create({ batchId, action: "SYNTHETIC_DEMO_CREATED", actorId: String(accounts.admin.user._id), eventTime: new Date(),
      reason: "User-authorized synthetic workflow verification. No actual vaccine product or medical policy is represented.", snapshot: { batchId, shipmentId, deviceId, quantity: 0 } });
    await call("POST", "/shipments/create", accounts.admin, { shipmentId, batchId, vaccineType: batch.vaccineType, quantity: 0,
      source: accounts.manufacturer.organization, distributor: accounts.distributor.organization, destination: accounts.hospital.organization,
      status: "Demo only — simulated in transit", idealTemperatureRange: "Synthetic fixture only; not a product specification" });
    const approved = await call("POST", `/alerts/policies/batch/${batchId}/approve`, accounts.admin, {
      minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 40, maximumHumidity: 80,
      excursionDurationMs: 120000, maximumReadingGapMs: 90000, criticalBatteryPercent: 10, maximumRateCelsiusPerMinute: 100,
      sourceReference: "SYNTHETIC SOFTWARE TEST FIXTURE ONLY — not an approved vaccine product/storage policy",
      approvalReason: "User-authorized automated demo on zero-dose synthetic batch only; not medical or regulatory approval",
    }, 201);
    await call("POST", "/simulator/devices", accounts.admin, { deviceId, vehicleId: "DEMO-TRUCK-01", batchId, shipmentId,
      scenario: "HIGH_TEMPERATURE", seed: "cold-chain-reviewed-demo-v1", startTime: new Date().toISOString(),
      tickIntervalMs: 60000, temperatureRange: { min: 2, max: 8 }, initialBatteryLevel: 100,
      route: [{ latitude: 9.9312, longitude: 76.2673 }, { latitude: 9.9412, longitude: 76.2773 }],
    }, 201);
    const readings = [];
    for (let tick = 0; tick < 3; tick++) {
      const result = await call("POST", `/simulator/${deviceId}/tick`, accounts.admin);
      readings.push({ ...result.reading, evaluation: result.persistedReading.evaluation });
      const notifications = await Notification.find({ auditBatchId: batchId }).lean();
      if (tick === 0) {
        assert.equal(result.persistedReading.evaluation.severity, "WARNING");
        assert.deepEqual(notifications.map(n => n.recipientRole).sort(), ["admin", "manufacturer"]);
      }
    }
    assert.equal(readings[2].evaluation.severity, "CRITICAL");
    const heldAlert = await Alert.findOne({ batchId, requiresQualityReview: true }).lean();
    assert.ok(heldAlert, "Sustained high temperature must quarantine");
    assert.ok((await Batch.findOne({ batchId })).coldChainHoldAlertIds.includes(heldAlert.alertId));
    assert.ok((await Shipment.findOne({ shipmentId })).coldChainHoldAlertIds.includes(heldAlert.alertId));
    const dispatch = await call("PATCH", `/distribution/distributor/supply/${shipmentId}`, accounts.distributor, { batchId }, 409);
    const administer = await call("POST", "/vaccinations/administer", accounts.hospital, { batchId, dosesUsed: 0, patientName: "SYNTHETIC DEMO — NO PATIENT" }, 409);
    assert.equal(dispatch.code, "COLD_CHAIN_HOLD"); assert.equal(administer.code, "COLD_CHAIN_HOLD");
    const visibility = {};
    for (const [name, account] of Object.entries(accounts)) {
      const visible = await call("GET", `/alerts?batchId=${batchId}`, account);
      const notes = await call("GET", "/alerts/notifications", account);
      assert.ok(visible.alerts.some(a => a.alertId === heldAlert.alertId), `${name} should see the event`);
      assert.ok(notes.notifications.some(n => n.alertId === heldAlert.alertId), `${name} should receive a notification`);
      visibility[name] = true;
    }
    await call("PATCH", `/alerts/${heldAlert.alertId}/clear`, accounts.manufacturer, { reason: "Synthetic non-reviewer access check", asOf: readings[2].timestamp }, 403);
    await call("POST", `/simulator/${deviceId}/scenario`, accounts.admin, { scenario: "NORMAL" });
    const recovered = await call("POST", `/simulator/${deviceId}/tick`, accounts.admin);
    readings.push({ ...recovered.reading, evaluation: recovered.persistedReading.evaluation });
    assert.equal(recovered.persistedReading.evaluation.severity, "NORMAL");
    assert.equal(recovered.persistedReading.evaluation.batchQuarantined, true, "Normal must not auto-release the hold");
    const asOf = recovered.reading.timestamp;
    await call("PATCH", `/alerts/${heldAlert.alertId}/clear`, accounts.admin, { reason: "Synthetic check: clearance before review must fail", asOf }, 409);
    const review = await call("PATCH", `/alerts/${heldAlert.alertId}/review`, accounts.admin, {
      reason: "Automated synthetic demo under user instruction: inspected four seeded samples, fixture policy, healthy battery/humidity, recovery and hold enforcement. No clinical material reviewed.", asOf,
    });
    assert.ok(review.alert.reviewedAt);
    const cleared = await call("PATCH", `/alerts/${heldAlert.alertId}/clear`, accounts.admin, {
      reason: "User-authorized automated clearance of zero-dose SYNTHETIC DEMO ONLY after recorded fixture review; not vaccine release or medical approval.", asOf,
    });
    assert.equal(cleared.alert.phase, "CLEARED");
    await call("POST", `/simulator/${deviceId}/stop`, accounts.admin);
    const finalBatch = await Batch.findOne({ batchId }).lean();
    const finalShipment = await Shipment.findOne({ shipmentId }).lean();
    assert.equal(finalBatch.coldChainHoldAlertIds.length, 0);
    assert.equal(finalShipment.coldChainHoldAlertIds.length, 0);
    assert.equal(finalBatch.status, "Demo only — no clinical inventory");
    assert.equal(finalShipment.status, "Demo only — simulated in transit");
    assert.equal(await Vaccination.countDocuments({ batchId }), 0);
    assert.equal(await TemperatureLog.countDocuments({ batchId }), 4);
    assert.deepEqual(await Batch.find({ _id: { $in: existingBatches.map(b => b._id) } }).sort({ _id: 1 }).lean(), existingBatches, "Existing batches changed");
    assert.deepEqual(await Shipment.find({ _id: { $in: existingShipments.map(s => s._id) } }).sort({ _id: 1 }).lean(), existingShipments, "Existing shipments changed");
    assert.deepEqual(blockedCalls, [], "An operational guard attempted an external service call");
    const auditTrail = await Audit.find({ batchId }).sort({ recordedAt: 1 }).lean();
    const notes = await Notification.find({ auditBatchId: batchId }).lean();
    assert.ok(auditTrail.some(entry => entry.action === "CLEARED"));
    console.log(JSON.stringify({ completedAt: new Date().toISOString(), database: mongoose.connection.name,
      batchId, shipmentId, deviceId, alertId: heldAlert.alertId, policyId: String(approved.policy._id),
      reviewer: accounts.admin.email, mappings: Object.values(accounts).filter(a => a.field).map(a => ({ email: a.email, field: a.field, organization: a.organization })),
      readings: readings.map(r => ({ timestamp: r.timestamp, temperature: r.temperature, humidity: r.humidity, batteryLevel: r.batteryLevel,
        latitude: r.latitude, longitude: r.longitude, severity: r.evaluation.severity, batchQuarantined: r.evaluation.batchQuarantined })),
      peakExplanation: heldAlert.reason, dispatchBlocked: dispatch.code, administrationBlocked: administer.code,
      recipientVisibility: visibility, normalDidNotReleaseHold: true, nonReviewerClearanceRejected: true, clearanceBeforeReviewRejected: true,
      finalPhase: cleared.alert.phase, finalBatchHolds: finalBatch.coldChainHoldAlertIds, finalShipmentHolds: finalShipment.coldChainHoldAlertIds,
      existingBatchCountPreserved: existingBatches.length, existingShipmentCountPreserved: existingShipments.length,
      notifications: notes.map(n => ({ stage: n.metadata.stage, recipientRole: n.recipientRole, recipient: n.recipientRefKey })),
      auditActions: auditTrail.map(entry => entry.action), externalServiceCalls: blockedCalls.length,
      note: "Synthetic app workflow approval/review only. No actual product policy was supplied and no real vaccine was released.",
    }, null, 2));
  } finally {
    simulatorManager.clear();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
