const express = require("express");
const request = require("supertest");
const User = require("../models/user");
const Log = require("../models/TemperatureLog");
const Alert = require("../models/TemperatureAlert");
const Notification = require("../models/Notification");
const Audit = require("../models/ColdChainAudit");
const { issueToken } = require("../middleware/auth");
const { connect, close, fixture } = require("./helpers/coldChainFixture");

process.env.EVENT_BACKBONE_ENABLED = "false";
jest.mock("../services/aiService", () => ({ ...jest.requireActual("../services/aiService"),
  getTelemetryAnomaly: jest.fn().mockResolvedValue({ status: "NOT_RUN", advisory_only: true, reason: "AI advisory mocked for route test" }) }));
const app = express();
app.use(express.json());
app.use("/api/readings", require("../routes/readingRoutes"));
const auth = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });
let f, admin, distributor, manufacturer, fieldOperator;

beforeAll(connect, 15000);
afterAll(close);
beforeEach(async () => {
  f = await fixture();
  [admin, distributor, manufacturer, fieldOperator] = await User.create([
    { email: `${f.batchId}-admin@test`, role: "admin" },
    { email: `${f.batchId}-dist@test`, role: "distributor", distributor: "dist-a" },
    { email: `${f.batchId}-maker@test`, role: "manufacturer" },
    { email: `${f.batchId}-operator@test`, role: "field_operator" },
  ]);
});

const payload = (overrides = {}) => ({ batchId: f.batchId, vehicleId: "TRUCK-TEST", temperature: 5.2, humidity: 58,
  battery: 90, lat: 9.9, lon: 76.2, timestamp: new Date(Date.now() - 60_000).toISOString(), note: "Synthetic manual check", ...overrides });

test("manual out-of-policy reading creates a policy alert and notifications and records actor/source", async () => {
  const response = await request(app).post("/api/readings/manual").set(auth(distributor)).send(payload({ temperature: 11 }));
  expect(response.status).toBe(202);
  const log = await Log.findById(response.body.reading._id).lean();
  expect(log).toMatchObject({ source: "manual", enteredBy: String(distributor._id), note: "Synthetic manual check", temperature: 11 });
  expect(await Alert.countDocuments({ batchId: f.batchId, metric: "TEMPERATURE" })).toBe(1);
  expect(await Notification.countDocuments({ auditBatchId: f.batchId })).toBeGreaterThan(0);
  expect(await Audit.countDocuments({ batchId: f.batchId, action: "Manual reading created", actorId: String(distributor._id) })).toBe(1);
}, 30000);

test("CSV import accepts valid rows, rejects invalid rows with reasons, and records CSV provenance", async () => {
  const csv = `batchId,vehicleId,temperature,humidity,battery,lat,lon,timestamp,note\n${f.batchId},TRUCK-1,5,58,90,9.9,76.2,${new Date(Date.now() - 120000).toISOString()},valid\n${f.batchId},TRUCK-1,70,58,90,9.9,76.2,${new Date(Date.now() - 60000).toISOString()},bad temperature\n`;
  const response = await request(app).post("/api/readings/import").set(auth(admin)).set("content-type", "text/csv").send(csv);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ accepted: 1, rejected: 1 });
  expect(response.body.results.find(row => row.status === "rejected").reason).toMatch(/60|greater|less|range/i);
  expect(await Log.countDocuments({ batchId: f.batchId, source: "csv" })).toBe(1);
  expect(await Audit.countDocuments({ action: "CSV telemetry import submitted", actorId: String(admin._id) })).toBe(1);
});

test("rapid manual temperature jumps are accepted but marked for review", async () => {
  const first = await request(app).post("/api/readings/manual").set(auth(distributor)).send(payload({
    temperature: 4, timestamp: new Date(Date.now() - 3 * 60_000).toISOString(),
  }));
  expect(first.status).toBe(202);
  const jump = await request(app).post("/api/readings/manual").set(auth(distributor)).send(payload({
    temperature: 13, timestamp: new Date(Date.now() - 2 * 60_000).toISOString(),
  }));
  expect(jump.status).toBe(202);
  expect(jump.body.needsReview).toBe(true);
  expect(await Log.findById(jump.body.reading._id).lean()).toMatchObject({ temperature: 13, needsReview: true });
});

test("correction appends a superseding reading without changing the original", async () => {
  const created = await request(app).post("/api/readings/manual").set(auth(fieldOperator)).send(payload({ temperature: 5 }));
  expect(created.status).toBe(202);
  const originalId = created.body.reading._id;
  const originalBefore = await Log.findById(originalId).lean();
  const corrected = await request(app).post(`/api/readings/${originalId}/correct`).set(auth(fieldOperator))
    .send(payload({ temperature: 6, note: "Corrected transcription" }));
  expect(corrected.status).toBe(202);
  expect(corrected.body.originalPreserved).toBe(true);
  expect(corrected.body.reading.supersedes).toBe(originalId);
  expect(await Log.findById(originalId).lean()).toMatchObject({ temperature: originalBefore.temperature, note: originalBefore.note });
  expect(await Log.countDocuments({ supersedes: originalId })).toBe(1);
  const merkle = require("../services/merkleAnchoring"), chain = require("../services/blockchainService");
  const Window = require("../models/MerkleWindow");
  const anchor = jest.spyOn(chain, "anchorSensorRoot").mockResolvedValue({ chainId: 31337, contractAddress: "0x1234", txHash: "0xsynthetic", gasUsed: "30000", gasPerReading: 15000 });
  jest.spyOn(chain, "merkleAddress").mockReturnValue("0x1234");
  jest.spyOn(chain, "getSensorRoot").mockImplementation(async id => { const window = await Window.findOne({ windowId: id }).lean();
    return { root: window.root, batchId: window.batchId, count: window.count, windowStart: +window.windowStart, windowEnd: +window.windowEnd, chainId: 31337 }; });
  const original = await Log.findById(originalId).lean(), correctedLog = await Log.findById(corrected.body.reading._id).lean();
  await merkle.stage(original); await merkle.stage(correctedLog);
  const leaf = await require("../models/MerkleLeaf").findOne({ readingId: original._id }).lean();
  await merkle.processOnce({ now: new Date(new Date(leaf.bucketEnd).getTime() + 1) });
  expect((await merkle.verifyReading(await Log.findById(originalId))).verified).toBe(true);
  expect((await merkle.verifyReading(await Log.findById(corrected.body.reading._id))).verified).toBe(true);
  expect(anchor).toHaveBeenCalledTimes(1);
}, 30000);

test("unauthorized role is denied manual reading access", async () => {
  const response = await request(app).post("/api/readings/manual").set(auth(manufacturer)).send(payload());
  expect(response.status).toBe(403);
});

test("CSV parser handles quoted notes and reports malformed quoting", () => {
  const { parseCsv } = require("../controllers/manualReadingController")._test;
  expect(parseCsv('batchId,note\nB-1,"manual, quoted note"')[0]).toMatchObject({ batchid: "B-1", note: "manual, quoted note" });
  expect(() => parseCsv('batchId,note\nB-1,"unterminated')).toThrow(/unterminated/i);
});
