// Compose-backed synthetic acceptance. Unique records are retained as auditable
// local demo evidence; this runner never deletes application or chain records.
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const startedAt = Date.now();
const milestones = [];
const record = (name) => milestones.push({ name, elapsedMs: Date.now() - startedAt });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(read, label, timeoutMs = 90000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await read(); if (result) return result; } catch (error) { lastError = error; }
    await wait(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function main() {
  assert.equal(process.env.ALERT_EMAIL_ENABLED, "true", "Compose must enable the alert email outbox");
  assert.equal(String(process.env.ALERT_EMAIL_TRANSPORT).toLowerCase(), "ethereal", "Acceptance requires the disposable Ethereal capture transport");
  await mongoose.connect(process.env.MONGO_URI);
  const Batch = require("../models/Batch"), Policy = require("../models/ColdChainPolicy");
  const Shipment = require("../models/Shipment"), User = require("../models/user");
  const Log = require("../models/TemperatureLog"), Alert = require("../models/TemperatureAlert");
  const Notification = require("../models/Notification"), EmailDelivery = require("../models/EmailDelivery");
  const Window = require("../models/MerkleWindow");
  const admin = await User.findOne({ email: "admin@demo.synthetic.test", role: "admin", canReviewColdChain: true }).lean();
  assert.ok(admin, "Seeded synthetic reviewer account is required");
  const password = process.env.DEMO_SEED_PASSWORD;
  assert.ok(password, "DEMO_SEED_PASSWORD is required");
  const origin = `http://127.0.0.1:${process.env.PORT || 5000}/api`;
  const request = async (method, route, token, body) => {
    const response = await fetch(origin + route, { method, headers: {
      "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    const payload = await response.json().catch(() => ({}));
    assert.ok(response.ok, `${method} ${route} returned ${response.status}: ${JSON.stringify(payload)}`);
    return payload;
  };
  const session = await request("POST", "/auth/login", null, { email: "admin@demo.synthetic.test", password, role: "admin" });
  assert.ok(session.token, "Admin login must return an access token");
  const token = session.token;

  const suffix = `${Date.now()}-${require("node:crypto").randomBytes(3).toString("hex")}`;
  const batchId = `SYNTHETIC-PHASE7-${suffix}`;
  const shipmentId = `SYNTHETIC-SHIP-${suffix}`;
  const deviceId = `SYNTHETIC-DOOR-${suffix}`;
  const vaccineType = "SYNTHETIC PHASE 7 VACCINE — NOT CLINICAL";
  const batch = await Batch.create({ batchId, vaccineType, quantity: 100, manufacturer: "Synthetic Demo Manufacturer",
    status: "Ready", isDemo: true, demoProvenance: { source: "phase-7-acceptance", nature: "synthetic", clinicalUse: false } });
  await Shipment.create({ shipmentId, batchId, vehicleId: `TRUCK-${suffix}`, routeId: "KOCHI-SYNTHETIC-ROUTE",
    vaccineType, quantity: 100, distributor: "Synthetic Demo Distributor", destination: "Synthetic Demo Hospital",
    status: "In Transit", isDemo: true });
  const chain = require("../services/blockchainService");
  await chain.registerBatchOnChain(batchId, vaccineType, 100);
  record("Synthetic batch registered on local chain");
  const approved = await request("POST", `/alerts/policies/batch/${encodeURIComponent(batchId)}/approve`, token, {
    minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 0, maximumHumidity: 100,
    excursionDurationMs: 120000, maximumReadingGapMs: 90000, criticalBatteryPercent: 10,
    maximumRateCelsiusPerMinute: 100, sourceReference: "Phase 7 synthetic acceptance fixture only",
    approvalReason: "Automated synthetic demo acceptance; not a medical approval",
  });
  assert.equal(approved.policy.batchId, batchId);
  assert.equal(String(approved.policy.approvedBy), String(admin._id));
  record("Approved 2–8 °C synthetic batch policy");

  if (process.env.DATA_MODE === "manual") {
    const manualResponse = await request("POST", "/readings/manual", token, {
      batchId, shipmentId, vehicleId: `TRUCK-${suffix}`, deviceId: `MANUAL-${suffix}`,
      temperature: 11, humidity: 58, battery: 90, lat: 9.9, lon: 76.2,
      timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      note: "Phase 3B synthetic acceptance manual temperature reading",
    });
    const manualReading = await until(() => Log.findById(manualResponse.reading?._id).lean(), "manual reading persisted");
    assert.equal(manualReading.source, "manual");
    assert.equal(manualReading.enteredBy, String(admin._id));
    assert.equal(manualReading.temperature, 11);
    record("Manual 11 °C reading persisted with actor/source");
    const manualAlert = await until(() => Alert.findOne({ batchId, temperatureLogId: manualReading._id, metric: "TEMPERATURE" }).lean(), "policy alert for manual excursion");
    assert.ok(manualAlert.reason.includes("above the approved maximum"));
    assert.equal(manualAlert.context?.source, "manual");
    record("Approved policy opened a manual-reading alert");
    const manualNotification = await until(() => Notification.findOne({ alertId: manualAlert.alertId, recipientRole: "admin" }).lean(), "manual alert notification");
    record("Manual alert notification persisted");
    const manualWindow = await until(() => Window.findOne({ batchId, readingIds: manualReading._id, status: "confirmed" }).lean(), "manual reading Merkle root confirmed on local chain", 360000, 1000);
    assert.equal(manualWindow.chainId, 31337);
    const manualVerified = await request("GET", `/verify/${encodeURIComponent(batchId)}/reading/${manualReading._id}`, token);
    assert.equal(manualVerified.verified, true);
    assert.equal(manualVerified.sensorEvidenceAnchored, "yes");
    record("Manual reading Merkle proof verified on local chain");
    const manualHistory = await request("GET", `/live-shipments/${encodeURIComponent(shipmentId)}/temperature-history?latest=true&limit=100`, token);
    assert.ok(manualHistory.records.some(row => row.readingId === String(manualReading._id) && row.source === "manual"),
      "shipment chart history API must expose the Manual reading point");
    record("Shipment chart history returned the Manual point");
    console.log("\nPhase 3B manual-only acceptance timing (synthetic local run)");
    console.log("Milestone                                      elapsed");
    console.log("---------------------------------------------  --------");
    for (const item of milestones) console.log(`${item.name.padEnd(45)} ${String(item.elapsedMs).padStart(6)} ms`);
    console.log(JSON.stringify({ outcome: "PASS", mode: "manual", synthetic: true, clinicalUse: false,
      batchId, shipmentId, readingId: String(manualReading._id), alertId: manualAlert.alertId,
      notificationId: String(manualNotification._id), merkleWindowId: manualWindow.windowId,
      sensorEvidenceAnchored: manualVerified.sensorEvidenceAnchored, milestones }, null, 2));
    return;
  }

  const startTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await request("POST", "/simulator/devices", token, { deviceId, vehicleId: `TRUCK-${suffix}`, batchId, shipmentId,
    scenario: "DOOR_OPEN", seed: `phase7-${suffix}`, startTime, tickIntervalMs: 60000,
    temperatureRange: { min: 2, max: 8 } });
  for (let index = 0; index < 3; index++) await request("POST", `/simulator/${encodeURIComponent(deviceId)}/tick`, token, {});

  const firstReading = await until(() => Log.findOne({ batchId, deviceId, "simulation.scenario": "DOOR_OPEN" }).sort({ sequenceNumber: 1 }).lean(), "first stored door_open reading");
  assert.ok(firstReading.temperature > 8, "door_open must produce an above-policy synthetic temperature");
  assert.ok(firstReading.edge?.gpsPlausibility && typeof firstReading.edge.gpsPlausibility.flagged === "boolean",
    "deployed gateway physical GPS advisory must survive ingestion/persistence");
  assert.ok(firstReading.edge.ruleProfile.includes("evaluation-only"), "stored edge output documents comparator distinction");
  record("Door-open reading persisted");
  const alert = await until(() => Alert.findOne({ batchId, deviceId, activeExcursionKey: { $exists: true } }).lean(), "opened policy alert");
  assert.ok(alert.reason.includes("above the approved maximum"), "policy-generated reason must explain the excursion");
  record("Policy alert opened");
  const notification = await until(() => Notification.findOne({ alertId: alert.alertId, recipientRole: "admin" }).sort({ createdAt: 1 }).lean(), "in-app alert notification");
  record("In-app notification persisted");

  const email = await until(async () => {
    await require("../services/emailOutbox").processOnce(50);
    return EmailDelivery.findOne({ alertId: alert.alertId, recipientRole: "admin", status: "sent", transportMode: "ethereal",
      providerPreviewUrl: { $type: "string", $ne: "" } }).lean();
  }, "Ethereal email capture with preview URL", 120000, 500);
  assert.equal(String(email.notificationId), String(notification._id));
  const capturedNotification = await Notification.findById(notification._id).lean();
  assert.ok(capturedNotification.emailPreviewLinks?.some(link => link.url === email.providerPreviewUrl), "captured email preview must be linked from its in-app notification");
  record("Ethereal email captured");

  const window = await until(() => Window.findOne({ batchId, status: "confirmed" }).sort({ confirmedAt: 1 }).lean(), "confirmed Merkle root on the configured local chain", 360000, 1000);
  assert.ok(window.count >= 1);
  assert.equal(window.chainId, 31337);
  assert.ok(window.gasUsed && window.gasPerReading > 0);
  record("Merkle root confirmed on local chain");

  const dashboard = await request("GET", `/alerts?batchId=${encodeURIComponent(batchId)}`, token);
  assert.ok(dashboard.alerts?.some(row => row.alertId === alert.alertId), "dashboard alert API must return this alert");
  record("Dashboard alert API returned the alert");
  const verified = await request("GET", `/verify/${encodeURIComponent(batchId)}`, token);
  assert.equal(verified.verified, true, "batch registration must verify");
  assert.equal(verified.sensorEvidenceAnchored, "yes", "sensor evidence must verify against an on-chain root");
  assert.ok(verified.evidence?.some(row => row.readingId === String(firstReading._id) && row.verified), "verification response must include anchored reading evidence");
  record("Verification endpoint returned anchored sensor evidence");

  // Phase 3B proves that an operator-entered reading uses the same accepted
  // stream and reaches persistence, policy, notification, anchoring and chart APIs.
  const manualResponse = await request("POST", "/readings/manual", token, {
    batchId, shipmentId, vehicleId: `TRUCK-${suffix}`, deviceId: `MANUAL-${suffix}`,
    temperature: 11, humidity: 58, battery: 90, lat: 9.9, lon: 76.2,
    timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    note: "Phase 3B synthetic acceptance manual temperature reading",
  });
  const manualReading = await until(() => Log.findById(manualResponse.reading?._id).lean(), "manual reading persisted");
  assert.equal(manualReading.source, "manual");
  assert.equal(manualReading.enteredBy, String(admin._id));
  assert.equal(manualReading.temperature, 11);
  record("Manual 11 °C reading persisted with actor/source");
  const manualAlert = await until(() => Alert.findOne({ batchId, temperatureLogId: manualReading._id, metric: "TEMPERATURE" }).lean(), "policy alert for manual excursion");
  assert.ok(manualAlert.reason.includes("above the approved maximum"));
  assert.equal(manualAlert.context?.source, "manual", "policy alert must retain Manual provenance");
  record("Approved policy opened a manual-reading alert");
  const manualNotification = await until(() => Notification.findOne({ alertId: manualAlert.alertId, recipientRole: "admin" }).lean(), "manual alert notification");
  record("Manual alert notification persisted");
  const manualWindow = await until(() => Window.findOne({ batchId, readingIds: manualReading._id, status: "confirmed" }).lean(), "manual reading Merkle root confirmed on local chain", 360000, 1000);
  assert.equal(manualWindow.chainId, 31337);
  const manualVerified = await request("GET", `/verify/${encodeURIComponent(batchId)}/reading/${manualReading._id}`, token);
  assert.equal(manualVerified.verified, true, "manual reading must verify against its confirmed Merkle root");
  assert.equal(manualVerified.sensorEvidenceAnchored, "yes");
  record("Manual reading Merkle proof verified on local chain");
  const history = await request("GET", `/live-shipments/${encodeURIComponent(shipmentId)}/temperature-history?latest=true&limit=100`, token);
  assert.ok(history.records.some(row => row.readingId === String(manualReading._id) && row.source === "manual"),
    "shipment chart history API must expose the Manual reading point");
  record("Shipment chart history returned the Manual point");

  // Physical GPS is advisory, survives the deployed Mongo gateway state, and
  // does not manufacture a temperature-policy alert for in-range readings.
  const gpsDeviceId = `GPS-PHYSICAL-${suffix}`;
  const { postSimulationReading } = require("../services/simulatorTelemetryTransport");
  for (let seq = 0; seq < 2; seq++) await postSimulationReading({ deviceId: gpsDeviceId, vehicleId: `TRUCK-${suffix}`,
    batchId, shipmentId, sequenceNumber: seq, temperature: 5, humidity: 58, batteryLevel: 90,
    latitude: 9.9 + seq, longitude: 76.2, timestamp: new Date(Date.now() - (120000 - seq * 60000)).toISOString(),
    simulation: { source: "software-iot-simulator", scenario: "GPS_JUMP", seed: suffix, tick: seq } });
  const gpsLog = await until(() => Log.findOne({ batchId, deviceId: gpsDeviceId, sequenceNumber: 1 }).lean(), "physical GPS reading persisted");
  assert.equal(gpsLog.edge.gpsPlausibility.flagged, true);
  assert.ok(gpsLog.edge.gpsPlausibility.impliedSpeedKmh > 120);
  const gpsAdvisory = await until(async () => {
    const row = await Log.findById(gpsLog._id).lean();
    return row.evaluation?.anomalyInference?.gps_plausibility?.flagged ? row.evaluation.anomalyInference : null;
  }, "AI physical GPS advisory with computed speed", 120000, 500);
  assert.ok(gpsAdvisory.reason.includes("GPS implies"));
  assert.equal(await Alert.countDocuments({ batchId, deviceId: gpsDeviceId, metric: "TEMPERATURE" }), 0);
  record("Physical GPS flagged by deployed gateway and AI; policy remains authoritative");

  for (let index = 1; index < milestones.length; index++) assert.ok(milestones[index].elapsedMs >= milestones[index - 1].elapsedMs, "acceptance milestones must be observed in order");
  console.log("\nPhase 7 acceptance timing (synthetic local run)");
  console.log("Milestone                                      elapsed");
  console.log("---------------------------------------------  --------");
  for (const item of milestones) console.log(`${item.name.padEnd(45)} ${String(item.elapsedMs).padStart(6)} ms`);
  console.log(JSON.stringify({ outcome: "PASS", synthetic: true, clinicalUse: false, batchId, shipmentId,
    readingId: String(firstReading._id), alertId: alert.alertId, notificationId: String(notification._id),
    manualReadingId: String(manualReading._id), manualAlertId: manualAlert.alertId,
    manualNotificationId: String(manualNotification._id), manualMerkleWindowId: manualWindow.windowId,
    emailPreviewUrl: email.providerPreviewUrl, merkleWindowId: window.windowId, chainId: window.chainId,
    gasUsed: window.gasUsed, gasPerReading: window.gasPerReading, milestones }, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
  // This diagnostic now publishes the physical-GPS pair itself. Release its
  // MQTT keepalive so the CLI exits and the API-restart proof can run next.
  try { await require("../services/mqttTelemetry").stopTelemetryClient(); }
  finally { await mongoose.disconnect(); }
});
