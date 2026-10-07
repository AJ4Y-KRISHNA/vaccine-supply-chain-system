// Actual HTTP/AI/Mongo/local-chain acceptance. Only a newly generated test DB is written.
const assert = require("node:assert/strict");
const { signDeviceTelemetry } = require("../edge-gateway/deviceAuth");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const mongoose = require("mongoose");
const { ethers } = require("ethers");
const root = path.resolve(__dirname, "../..");
const children = [];
const dbName = `codex_cc_test_${randomBytes(8).toString("hex")}`;
let server, provider;
const measurements = [];
async function freePort() {
  const s = net.createServer(); await new Promise(resolve => s.listen(0, "127.0.0.1", resolve));
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port;
}
function start(command, args, cwd, environment = {}) {
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ENABLE_EXPERIMENTAL_BERT: "false", ...environment } });
  child.diagnostics = ""; child.stderr.on("data", b => { child.diagnostics = (child.diagnostics + b).slice(-2000); });
  children.push(child); return child;
}
async function ready(url, child, body) {
  for (let count = 0; count < 120; count++) {
    if (child.exitCode !== null) throw new Error(`Local service exited: ${child.diagnostics}`);
    try { const r = await fetch(url, { ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(1000) }); if (r.ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Local test service did not become ready");
}
async function main() {
  if (!process.argv.includes("--execute")) throw new Error("Run with --execute to create and remove an isolated synthetic test database and local test services");
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = randomBytes(32).toString("hex"); process.env.REFRESH_SECRET = randomBytes(32).toString("hex"); process.env.TEMP_API_KEY = randomBytes(32).toString("hex");
  const acceptanceMongoBase = new URL(process.env.ACCEPTANCE_MONGO_URI || "mongodb://127.0.0.1:27017");
  if (!/^mongodb(?:\+srv)?:$/.test(acceptanceMongoBase.protocol)) throw new Error("ACCEPTANCE_MONGO_URI must be a MongoDB URI");
  acceptanceMongoBase.pathname = `/${dbName}`;
  process.env.MONGO_URI = acceptanceMongoBase.toString();
  process.env.LOCAL_CHAIN_DEMO = "true"; process.env.AUDIT_ANCHOR_ENABLED = "false";
  process.env.TELEMETRY_ANCHOR_MODE = "legacy"; // Exercise the retained raw-record compatibility path.
  process.env.MQTT_TELEMETRY_SUBSCRIBER_ENABLED = "false";
  process.env.EDGE_GATEWAY_DEVICE_SECRET = randomBytes(32).toString("hex");
  const chainPort = await freePort(), aiPort = await freePort();
  const previewPort = process.argv.includes("--preview") ? await freePort() : null;
  if (previewPort) process.env.CORS_ORIGINS = `http://127.0.0.1:${previewPort}`;
  process.env.RPC_URL = `http://127.0.0.1:${chainPort}`;
  process.env.AI_BASE_URL = `http://127.0.0.1:${aiPort}`;
  const chainProcess = start(process.execPath, ["node_modules/hardhat/internal/cli/cli.js", "node", "--hostname", "127.0.0.1", "--port", String(chainPort)], path.join(root, "blockchain"));
  const aiProcess = start(process.env.PYTHON_EXECUTABLE || "python", ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(aiPort)], path.join(root, "ai-services"));
  await Promise.all([ready(process.env.RPC_URL, chainProcess, { jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }), ready(process.env.AI_BASE_URL, aiProcess)]);
  const aiProbeId = "acceptance.ai-probe.v1";
  const aiProbe = await fetch(process.env.AI_BASE_URL, { headers: { "x-correlation-id": aiProbeId }, signal: AbortSignal.timeout(5000) });
  assert.equal(aiProbe.headers.get("x-correlation-id"), aiProbeId);
  provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = index => ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, `m/44'/60'/0'/0/${index}`).connect(provider);
  const artifact = require("../../blockchain/artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json");
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet(0)).deploy(wallet(1).address, wallet(2).address);
  await contract.waitForDeployment(); process.env.CONTRACT_ADDRESS = await contract.getAddress(); process.env.MERKLE_CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  const app = require("../server"); await mongoose.connection.asPromise();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const User = require("../models/user"), Batch = require("../models/Batch"), Alert = require("../models/TemperatureAlert");
  const TemperatureLog = require("../models/TemperatureLog"), Notification = require("../models/Notification");
  const Order = require("../models/Order");
  const password = randomBytes(24).toString("hex"), hashed = await require("bcryptjs").hash(password, 10);
  const actors = {};
  for (const role of ["admin", "manufacturer", "distributor", "healthcare"]) {
    actors[role] = await User.create({ email: `${role}@acceptance.example.test`, password: hashed, role,
      manufacturer: role === "manufacturer" ? "SYNTHETIC Maker" : undefined,
      distributor: role === "distributor" ? "SYNTHETIC Distributor" : undefined,
      hospital: role === "healthcare" ? "SYNTHETIC Hospital" : undefined, canReviewColdChain: role === "admin" });
  }
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const edgeGatewayPort = await freePort();
  const edgeGatewayApiKey = randomBytes(32).toString("hex");
  const edgeGatewayProcess = start(process.execPath, ["edge-gateway/server.js"], path.join(root, "backend"), {
    EDGE_GATEWAY_HOST: "127.0.0.1", EDGE_GATEWAY_PORT: String(edgeGatewayPort),
    MONGO_URI: process.env.MONGO_URI, EDGE_GATEWAY_DEVICE_SECRET: process.env.EDGE_GATEWAY_DEVICE_SECRET,
    EDGE_GATEWAY_API_KEY: edgeGatewayApiKey, EDGE_GATEWAY_UPSTREAM_API_KEY: process.env.TEMP_API_KEY,
    EDGE_GATEWAY_UPSTREAM_URL: `${base}/temperature/ingest`, EDGE_GATEWAY_MQTT_ENABLED: "false",
  });
  const edgeGatewayUrl = `http://127.0.0.1:${edgeGatewayPort}`;
  await ready(`${edgeGatewayUrl}/health`, edgeGatewayProcess);
  // Keep simulator HTTP ingestion inside this isolated acceptance run and pass
  // it through the separate Edge Gateway before it reaches the legacy backend.
  process.env.SIMULATOR_TRANSPORT = "http";
  process.env.SIMULATOR_INGEST_URL = `${edgeGatewayUrl}/ingest`;
  process.env.SIMULATOR_INGEST_API_KEY = edgeGatewayApiKey;
  console.log("Acceptance: separate Edge Gateway process ready; HTTP telemetry is routed through it");
  async function call(method, route, role, body, expected = 200) {
    const start = performance.now();
    const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", ...(actors[role]?.token ? { Authorization: `Bearer ${actors[role].token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const data = await response.json(); measurements.push({ route, status: response.status, ms: Math.round(performance.now() - start) });
    assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data)}`); return data;
  }
  for (const role of Object.keys(actors)) actors[role].token = (await call("POST", "/auth/login", null, { email: actors[role].email, role, password })).token;
  console.log("Acceptance: authenticated synthetic role accounts");
  const formBatchId = "SYSTEM-ACCEPTANCE-FORM";
  const formPayload = { batchId: formBatchId, vaccineType: "SYNTHETIC FORM PRODUCT", quantity: 25,
    supplier: "SYNTHETIC Supplier", materialType: "SYNTHETIC ONLY", materialQuantity: 25, unit: "test units",
    expiresAt: "2099-12-31T00:00:00.000Z", remarks: "Fresh form-input acceptance fixture" };
  const formCreated = await call("POST", "/manufacturer/workflow", "manufacturer", formPayload);
  assert.equal(formCreated.batch.manufacturer, "SYNTHETIC Maker");
  assert.equal(formCreated.batch.releaseVisibleToExternal, false);
  assert.equal(formCreated.batch.certificateMinted, true);
  assert.ok(formCreated.txHash);
  assert.equal((await contract.getBatch(formBatchId))[0], formBatchId);
  assert.equal((await contract.getReleaseState(formBatchId))[2], false);
  const refreshed = await call("GET", "/dashboard/manufacturer", "manufacturer");
  assert.ok(refreshed.batches.some(batch => batch.batchId === formBatchId && batch.expiresAt === formPayload.expiresAt));
  await call("POST", "/manufacturer/workflow", "manufacturer", formPayload, 409);
  console.log("Acceptance: fresh form workflow registered on-chain, dashboard refreshed, duplicate rejected");
  const batchId = "SYSTEM-ACCEPTANCE-DEMO", vaccineType = "SYNTHETIC TEST PRODUCT — NOT CLINICAL";
  await call("POST", "/manufacturer/raw-materials", "manufacturer", { batchId, supplier: "SYNTHETIC Supplier", quantity: 100, materialType: "SYNTHETIC ONLY", unit: "test units" });
  await call("POST", "/manufacturer/produce", "manufacturer", { batchId, vaccineType, quantity: 100 });
  const manufactured = await call("POST", "/manufacturer/batch", "manufacturer", { batchId, vaccineType, quantity: 100, expiresAt: "2030-12-31T00:00:00Z" });
  await call("POST", "/manufacturer/batch/report", "manufacturer", { batchId, vaccineType, quantity: 100, materialQuantity: 100, remarks: "SYNTHETIC fixture quality report only" });
  assert.equal(manufactured.batch.releaseVisibleToExternal, false);
  await call("POST", `/manufacturer/batch/${batchId}/sign-release`, "manufacturer", { role: "Production" });
  await call("POST", `/manufacturer/batch/${batchId}/sign-release`, "manufacturer", { role: "Lab Testing" });
  assert.equal((await contract.getReleaseState(batchId))[2], true);
  assert.equal((await call("GET", `/batches/verify/${batchId}`, "admin")).verified, true);
  const forecastProduct = "SYNTHETIC FORECAST PRODUCT";
  const currentMonth = new Date();
  const forecastOrders = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - index - 1, 15, 12));
    return {
      orderId: `SYSTEM-ACCEPTANCE-FORECAST-${index + 1}`,
      auditBatchId: `SYSTEM-ACCEPTANCE-FORECAST-AUDIT-${index + 1}`,
      hospital: "SYNTHETIC Hospital",
      vaccineType: forecastProduct,
      requestedDoses: 10 + (5 - index) * 2,
      status: "Pending",
      createdAt: month,
      updatedAt: month,
    };
  });
  await Order.insertMany(forecastOrders);
  const forecast = await call("POST", "/forecast", "admin", { vaccineType: forecastProduct, months: 12, horizon: 6 });
  assert.equal(forecast.forecast.provenance.source, "MongoDB persisted Order records");
  assert.equal(forecast.forecast.provenance.synthetic, false);
  assert.equal(forecast.forecast.provenance.observed_order_months, 6);
  assert.equal(forecast.forecast.provenance.order_count, 6);
  assert.equal(forecast.forecast.forecast_periods.length, 6);
  const order = await call("POST", "/orders/hospital", "healthcare", { vaccineType, requestedDoses: 40, priority: "High", notes: "Synthetic acceptance order" }, 201);
  const plan = await call("POST", "/admin/supply-plan", "admin", { asOf: "2026-09-17T10:00:00Z", transportCapacityDoses: 50,
    destinations: [{ orderId: order.orderId, freeCapacityDoses: 40, transitHours: 2 }] }, 201);
  assert.equal(plan.totalAllocated, 40); assert.equal(plan.allocations[0].batchId, batchId);
  const approved = await call("PATCH", `/orders/${order.orderId}/review`, "admin", { decision: "approve", batchId, distributor: "SYNTHETIC Distributor" });
  const shipmentId = approved.shipmentId, deviceId = "SYSTEM-ACCEPTANCE-IOT";
  await call("POST", "/shipments/create", "admin", { shipmentId: "OVERALLOCATE", batchId, quantity: 61 }, 409);
  await call("POST", `/alerts/policies/batch/${batchId}/approve`, "admin", {
    minimumTemperature: 2, maximumTemperature: 8, minimumHumidity: 40, maximumHumidity: 80, excursionDurationMs: 120000,
    maximumReadingGapMs: 90000, criticalBatteryPercent: 10, maximumRateCelsiusPerMinute: 100,
    sourceReference: "SYNTHETIC SOFTWARE TEST ONLY", approvalReason: "Fixture only, not product or medical approval" }, 201);
  const acceptanceClock = Date.now() - 10 * 60 * 1000;
  const baselineReadings = Array.from({ length: 5 }, (_, index) => ({
    batchId, shipmentId, deviceId, sensorId: deviceId, vehicleId: "DEMO-TRUCK",
    sequenceNumber: 100 + index, temperature: 5, humidity: 55 + index, batteryLevel: 100,
    recordedAt: new Date(acceptanceClock + index * 60000).toISOString(),
  })).map(reading => ({ ...reading, deviceSignature: signDeviceTelemetry(process.env.EDGE_GATEWAY_DEVICE_SECRET, reading) }));
  const baselineCorrelationId = "acceptance.telemetry-baseline.v1";
  const baselineResponse = await fetch(`${edgeGatewayUrl}/ingest`, { method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": edgeGatewayApiKey,
      "x-correlation-id": baselineCorrelationId },
    body: JSON.stringify(baselineReadings), signal: AbortSignal.timeout(60000) });
  const storedBaseline = await baselineResponse.json();
  measurements.push({ route: "Edge Gateway -> backend (five baseline readings)", status: baselineResponse.status, ms: 0 });
  assert.equal(baselineResponse.status, 200, JSON.stringify(storedBaseline));
  assert.equal(storedBaseline.length, 5);
  assert.equal(baselineResponse.headers.get("x-correlation-id"), baselineCorrelationId);
  assert.ok(storedBaseline.every(row => row.correlationId === baselineCorrelationId));
  assert.ok(storedBaseline.every(row => row.evaluation?.anomalyInference?.status === "INSUFFICIENT_HISTORY"));
  await call("POST", "/simulator/devices", "admin", { deviceId, vehicleId: "DEMO-TRUCK", batchId, shipmentId, scenario: "HIGH_TEMPERATURE",
    seed: "system-acceptance-v1", startTime: new Date(acceptanceClock + 11 * 60000).toISOString(), tickIntervalMs: 60000, temperatureRange: { min: 2, max: 8 } }, 201);
  for (let i = 0; i < 3; i++) await call("POST", `/simulator/${deviceId}/tick`, "admin");
  const alert = await Alert.findOne({ batchId, requiresQualityReview: true }); assert.ok(alert);
  const telemetry = await TemperatureLog.find({ batchId, deviceId }).sort({ recordedAt: -1 }).lean();
  assert.equal(telemetry.length, 8);
  assert.ok(telemetry.every(row => row.evaluation?.evaluated), JSON.stringify(telemetry.map(row => ({ sequenceNumber: row.sequenceNumber,
    evaluation: row.evaluation, edge: row.edge }))));
  const simulatedReadings = telemetry.filter(row => row.simulation?.scenario === "HIGH_TEMPERATURE");
  assert.equal(simulatedReadings.length, 3);
  assert.ok(simulatedReadings.every(row => /^[0-9a-f-]{36}$/i.test(row.correlationId)));
  assert.ok(simulatedReadings.every(row => Number.isFinite(row.location?.lat) && Number.isFinite(row.location?.lng)));
  const inferredOutlier = simulatedReadings.find(row => row.evaluation?.anomalyInference?.status === "ANOMALY");
  assert.ok(inferredOutlier?.evaluation.anomalyInference.reason.includes("prior-window median"));
  assert.equal(alert.context.anomalyInference.status, "ANOMALY");
  assert.equal(alert.context.anomalyInference.advisoryOnly, true);
  assert.ok(simulatedReadings.some(row => row.correlationId === alert.correlationId));
  const locations = await call("GET", `/location-history/${batchId}`, "admin");
  assert.equal(locations.points.length, 3);
  assert.deepEqual(locations.points.map(point => point.sequenceNumber), [5, 6, 7]);
  assert.ok(simulatedReadings.every(row => row.edge?.localAlert?.active === true));
  const live = await call("GET", `/live-shipments?shipmentId=${encodeURIComponent(shipmentId)}`, "admin");
  assert.equal(live.shipments[0].latestTelemetry.deviceId, deviceId);
  assert.ok(live.shipments[0].latestTelemetry.temperature > 8);
  assert.ok(live.shipments[0].batchColdChainHoldAlertIds.includes(alert.alertId));
  const story = await call("GET", `/batches/${batchId}/story`, "admin");
  assert.ok(story.events.some(event => event.kind === "ai_inference" && event.anomalyInference?.status === "ANOMALY"));
  const linkLossDeviceId = `${deviceId}-LINK-LOSS`;
  await call("POST", "/simulator/devices", "admin", { deviceId: linkLossDeviceId, vehicleId: "LINK-LOSS-TRUCK",
    batchId, scenario: "LINK_LOSS", seed: "system-acceptance-link-loss-v1",
    startTime: new Date(acceptanceClock + 10 * 60000).toISOString(), tickIntervalMs: 60000, temperatureRange: { min: 2, max: 8 } }, 201);
  for (let index = 0; index < 3; index++) {
    const buffered = await call("POST", `/simulator/${linkLossDeviceId}/tick`, "admin");
    assert.equal(buffered.persistedReading.delivery, "buffered");
  }
  const EdgeGatewayQueue = require("../models/EdgeGatewayQueue");
  const heldRows = await EdgeGatewayQueue.find({ deviceId: linkLossDeviceId, status: "pending" }).sort({ sequenceNumber: 1 }).lean();
  assert.deepEqual(heldRows.map(row => row.sequenceNumber), [0, 1, 2]);
  await call("POST", `/simulator/${linkLossDeviceId}/scenario`, "admin", { scenario: "NORMAL" });
  await call("POST", `/simulator/${linkLossDeviceId}/tick`, "admin");
  const linkLossRows = await EdgeGatewayQueue.find({ deviceId: linkLossDeviceId }).sort({ sequenceNumber: 1 }).lean();
  assert.deepEqual(linkLossRows.map(row => row.sequenceNumber), [0, 1, 2, 3]);
  assert.ok(linkLossRows.every(row => row.status === "forwarded" && row.telemetry.edge?.localAlert));
  const storedLinkLoss = await TemperatureLog.find({ deviceId: linkLossDeviceId }).sort({ sequenceNumber: 1 }).lean();
  assert.deepEqual(storedLinkLoss.map(row => row.sequenceNumber), [0, 1, 2, 3]);
  assert.ok(storedLinkLoss.every(row => row.edge?.localAlert));
  const routedNotifications = await Notification.find({ alertId: alert.alertId }).lean();
  const ColdChainAudit = require("../models/ColdChainAudit");
  const alertAudits = await ColdChainAudit.find({ alertId: alert.alertId }).lean();
  assert.ok(alertAudits.some(row => row.correlationId === alert.correlationId));
  assert.ok(routedNotifications.some(row => row.recipientRole === "admin" && row.metadata?.stage === "QUARANTINED"));
  assert.ok(routedNotifications.some(row => row.recipientRole === "manufacturer" && row.metadata?.stage === "QUARANTINED"));
  assert.ok(routedNotifications.filter(row => row.metadata?.stage === "QUARANTINED")
    .every(row => row.correlationId === alert.correlationId));
  let capturedAlertEmails = [];
  if (process.env.ALERT_EMAIL_ENABLED === "true" && process.env.ALERT_EMAIL_TRANSPORT === "ethereal") {
    const emailOutbox = require("../services/emailOutbox"), EmailDelivery = require("../models/EmailDelivery");
    for (let attempt = 0; attempt < 40; attempt++) {
      await emailOutbox.processOnce(50);
      capturedAlertEmails = await EmailDelivery.find({ alertId: alert.alertId, status: "sent", transportMode: "ethereal" })
        .select("notificationId recipientRole providerMessageId providerPreviewUrl simulated").lean();
      const roles = new Set(capturedAlertEmails.map(row => row.recipientRole));
      if (roles.has("admin") && roles.has("manufacturer")) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(capturedAlertEmails.some(row => row.recipientRole === "admin" && row.providerPreviewUrl));
    assert.ok(capturedAlertEmails.some(row => row.recipientRole === "manufacturer" && row.providerPreviewUrl));
    const capturedNotifications = await Promise.all(capturedAlertEmails.map(row => Notification.findById(row.notificationId).lean()));
    assert.ok(capturedAlertEmails.every((row, index) => capturedNotifications[index]?.emailPreviewLinks?.some(link =>
      link.url === row.providerPreviewUrl && link.transportMode === "ethereal")), "each captured Ethereal URL must be exposed by its in-app notification");
    console.log(JSON.stringify({ capturedAlertEmails: capturedAlertEmails.map(({ recipientRole, providerMessageId, providerPreviewUrl }) =>
      ({ recipientRole, providerMessageId, providerPreviewUrl })) }));
  }
  await call("PATCH", `/distribution/distributor/supply/${shipmentId}`, "distributor", {}, 409);
  await call("POST", "/vaccinations/administer", "healthcare", { batchId, dosesUsed: 1 }, 409);
  for (const role of Object.keys(actors)) {
    const list = await call("GET", `/alerts?batchId=${batchId}`, role);
    assert.ok(list.alerts.some(row => row.alertId === alert.alertId));
  }
  await call("POST", `/simulator/${deviceId}/scenario`, "admin", { scenario: "NORMAL" });
  const normal = await call("POST", `/simulator/${deviceId}/tick`, "admin");
  assert.equal(normal.persistedReading.edge?.localAlert?.active, false);
  const stillHeld = await Batch.findOne({ batchId }).lean();
  assert.ok(stillHeld.coldChainHoldAlertIds.includes(alert.alertId));
  const review = { asOf: normal.reading.timestamp, reason: "Synthetic software acceptance review; no clinical material" };
  await call("PATCH", `/alerts/${alert.alertId}/clear`, "admin", review, 409);
  await call("PATCH", `/alerts/${alert.alertId}/acknowledge`, "admin", { reason: "Synthetic operator acknowledged the excursion" });
  await call("PATCH", `/alerts/${alert.alertId}/action-taken`, "admin", { action: "inspect", reason: "Synthetic operator inspected simulator evidence" });
  await call("PATCH", `/alerts/${alert.alertId}/review`, "admin", review);
  await call("PATCH", `/alerts/${alert.alertId}/clear`, "admin", review);
  assert.equal((await Batch.findOne({ batchId })).coldChainHoldAlertIds.length, 0);
  await call("PATCH", `/distribution/distributor/verify/${shipmentId}`, "distributor", {});
  await call("PATCH", `/distribution/distributor/status/${shipmentId}`, "distributor", { status: "In Transit" });
  await call("PATCH", `/distribution/distributor/supply/${shipmentId}`, "distributor", {});
  const delivered = await call("PATCH", `/distribution/healthcare/confirm/${shipmentId}`, "healthcare", { hospital: "SYNTHETIC Hospital" });
  assert.equal(delivered.shipment.hospitalConfirmed, true);
  const administrationPayload = { batchId, vaccineType, dosesUsed: 1, operationId: "SYSTEM-ACCEPTANCE-ADMINISTRATION-1",
    patientName: "SYNTHETIC REFERENCE ONLY", healthAuthority: "SYNTHETIC Demo authority", receivedDoses: 0, requestedDoses: 0 };
  const administered = await call("POST", "/vaccinations/workflow", "healthcare", administrationPayload);
  const administrationReplay = await call("POST", "/vaccinations/workflow", "healthcare", administrationPayload);
  assert.equal(administrationReplay.alreadyRecorded, true);
  assert.equal(administrationReplay.administration._id, administered.administration._id);
  assert.equal(administrationReplay.report._id, administered.report._id);
  assert.equal(administrationReplay.txHash, administered.txHash);
  const recordedAdministrations = await require("../models/Vaccination").find({ batchId, eventType: "Vaccination" }).lean();
  assert.equal(recordedAdministrations.length, 1);
  assert.equal(recordedAdministrations.reduce((sum, record) => sum + record.dosesUsed, 0), 1);
  const hospitalDashboard = await call("GET", "/dashboard/healthcare", "healthcare");
  assert.equal(hospitalDashboard.cards.vaccinesAvailable, 39);
  assert.equal(hospitalDashboard.cards.vaccinatedToday, 1);
  assert.equal(hospitalDashboard.dailyProgress.reduce((sum, value) => sum + value, 0), 1);
  const anchors = await require("../services/auditAnchoring").processOnce(200); assert.equal(anchors.failed, 0); assert.ok(anchors.confirmed >= 6);
  const evidence = await call("GET", `/batches/${batchId}/audit-anchors`, "admin");
  assert.ok(evidence.entries.every(entry => entry.kind === "temperature-reading" ? entry.rawChain?.verified : entry.verified));
  const sensorEvidence = evidence.entries.filter(entry => entry.kind === "temperature-reading");
  assert.ok(sensorEvidence.length >= 8); assert.ok(sensorEvidence.every(entry => entry.rawChain?.verified && entry.rawChain.reading?.digest === entry.rawChain.digest));
  const verificationPayload = await call("GET", `/batches/${batchId}/verification-payload`, "admin");
  assert.ok(verificationPayload.latestReading?.recordId && verificationPayload.latestReading?.digest && verificationPayload.latestReading?.transactionHash);
  const onChainHistory = await call("GET", `/batches/${batchId}/on-chain-telemetry?limit=500`, "admin");
  assert.ok(onChainHistory.total >= 8); assert.ok(onChainHistory.readings.every(reading => reading.digest));
  assert.equal(onChainHistory.readings.at(-1).recordId, verificationPayload.latestReading.recordId);
  const proofQuery = new URLSearchParams({ recordId: verificationPayload.latestReading.recordId,
    digest: verificationPayload.latestReading.digest, transactionHash: verificationPayload.latestReading.transactionHash,
    chainId: String(verificationPayload.chainId),
    contractAddress: verificationPayload.contractAddress }).toString();
  const verifiedQr = await call("GET", `/batches/verify/${batchId}?${proofQuery}`, "admin");
  assert.equal(verifiedQr.telemetryVerified, true); assert.equal(verifiedQr.verifiedReading.digest, verificationPayload.latestReading.digest);
  const replay = await require("../services/auditAnchoring").processOnce(200); assert.equal(replay.confirmed, 0);
  await require("./verifyPhase4Analytics")(call);
  const legacyMode = process.env.TELEMETRY_ANCHOR_MODE;
  process.env.TELEMETRY_ANCHOR_MODE = "merkle";
  const phase5 = await require("./verifyPhase5Blockchain")(async (method, route, role, data, status) => {
    if (role !== "device") return call(method, route, role, data, status);
    const response = await fetch(base + route, { method, headers: { "Content-Type": "application/json", "x-api-key": process.env.TEMP_API_KEY }, body: JSON.stringify(data) });
    const result = await response.json(); assert.equal(response.status, 200); return result;
  });
  process.env.TELEMETRY_ANCHOR_MODE = legacyMode;
  // Preserve proof metrics, not the disposable clinical-looking records.
  const ticks = measurements.filter(row => row.route.endsWith("/tick")).map(row => row.ms).sort((a, b) => a - b);
  console.log(JSON.stringify({ outcome: "PASS", scope: "isolated synthetic local services, not production or clinical validation",
    httpRequests: measurements.length, forecast: { model: forecast.forecast.model, predictedDemand: forecast.forecast.predicted_demand,
      source: forecast.forecast.provenance.source, observedOrderMonths: forecast.forecast.provenance.observed_order_months,
      forecastPeriods: forecast.forecast.forecast_periods.length },
    manufacturedDoses: 100, additionalFormTestDoses: 25, allocatedDoses: 40, deliveredDoses: 40, telemetryReadings: ticks.length,
    anchoredAuditEvents: evidence.entries.length, verifiedAuditEvents: evidence.entries.filter(entry => entry.kind !== "temperature-reading" && entry.verified).length,
    verifiedRawTelemetryRecords: sensorEvidence.filter(entry => entry.rawChain?.verified).length,
    phase5,
    latestTelemetryTransaction: verificationPayload.latestReading.transactionHash,
    tickLatencyMs: { min: ticks[0], max: ticks.at(-1), median: ticks[Math.floor(ticks.length / 2)] },
    elapsedSimulationToQuarantineMs: alert.excursionDurationMs, capturedAlertEmailCount: capturedAlertEmails.length,
    chainId: 31337, checks: ["separate Edge Gateway process health", "Edge Gateway HTTP validation/authentication/forwarding to backend", "simulator HTTP route through Edge Gateway", "Mongo-persisted edge local alert metrics", "link_loss buffered readings replayed without sequence gaps or duplicates", "manufacture", "fresh batch form API", "two-address release", "forecast", "capacity plan", "traceable approval", "over-allocation rejected", "five-reading inference baseline", "simulated telemetry persisted", "advisory anomaly explanation in batch story", "batch GPS history API", "live shipment reads latest telemetry", "admin/manufacturer notification records", "quarantine blocks dispatch and administration", "all-role alert visibility", "review required before clear", "delivery", "confirmed-stock administration", "HTTP administration replay without duplicate debit", "append-only raw telemetry and digest verification", "paginated raw history read directly from contract", "hash-bearing QR API verification", "audit anchor verification and replay", "correlation ID roundtrip and persistence", "simulator correlation through alert/notification", "AI service correlation header echo", ...(capturedAlertEmails.length ? ["SMTP alert capture for admin and manufacturer", "Ethereal previews persisted on in-app notification records"] : [])] }, null, 2));
  if (process.argv.includes("--preview")) {
    const port = previewPort;
    start(process.execPath, ["node_modules/react-scripts/bin/react-scripts.js", "start"], path.join(root, "frontend"),
      { PORT: String(port), HOST: "127.0.0.1", BROWSER: "none", REACT_APP_API_BASE: base, WDS_SOCKET_PORT: String(port) });
    console.log(JSON.stringify({ previewUrl: `http://127.0.0.1:${port}`, accounts: Object.fromEntries(Object.entries(actors).map(([role, actor]) => [role, actor.email])),
      temporaryTestPassword: password, testDatabase: dbName, notice: "Disposable isolated accounts only; never application credentials. Run with an interactive terminal and send exit to clean up. Automatically closes after 20 minutes." }));
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 20 * 60 * 1000);
      const finish = () => { clearTimeout(timeout); resolve(); };
      process.stdin.resume(); process.stdin.once("data", finish); process.once("SIGINT", finish); process.once("SIGTERM", finish);
    });
    process.stdin.pause();
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
  if (server) { require("../controllers/simulatorController").simulatorManager.clear(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (mongoose.connection.readyState && mongoose.connection.name === dbName && /^codex_cc_test_[a-f0-9]{16}$/.test(dbName)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); provider?.destroy();
  for (const child of children) child.kill();
  console.log("Cleaned only this run's isolated test database and stopped its local child services; application database unchanged.");
});
