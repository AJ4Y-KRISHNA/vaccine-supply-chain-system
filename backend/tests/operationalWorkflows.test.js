jest.mock("../services/blockchainService", () => ({
  recordOnBlockchain: jest.fn(), logLifecycleEventOnChain: jest.fn(), updateBatchStatusOnChain: jest.fn(),
  extractHash: receipt => receipt?.hash || "",
}));
const express = require("express");
const request = require("supertest");
const { connect, close } = require("./helpers/coldChainFixture");
const { issueToken } = require("../middleware/auth");
const User = require("../models/user");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Vaccination = require("../models/Vaccination");
const Distribution = require("../models/Distribution");
const Notification = require("../models/Notification");
const chain = require("../services/blockchainService");
const app = express(); app.use(express.json());
app.use("/api/distribution", require("../routes/distributionRoutes"));
app.use("/api/vaccinations", require("../routes/vaccinationRoutes"));
let distributor, hospital, outsider, sequence = 0;
const auth = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: user.role })}` });
const patch = (path, user, body = {}) => request(app).patch(`/api/distribution/${path}`).set(auth(user)).send(body);
const post = (path, body, user = hospital) => request(app).post(`/api/vaccinations/${path}`).set(auth(user)).send(body);
beforeAll(async () => {
  await connect();
  distributor = await User.create({ email: "ops-distributor@example.test", role: "distributor", distributor: "Operations Distributor" });
  hospital = await User.create({ email: "ops-hospital@example.test", role: "healthcare", hospital: "Operations Hospital" });
  outsider = await User.create({ email: "other-hospital@example.test", role: "healthcare", hospital: "Other Hospital" });
}, 15000);
afterAll(close);
beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  for (const name of ["recordOnBlockchain", "logLifecycleEventOnChain", "updateBatchStatusOnChain"]) chain[name].mockResolvedValue({ hash: `0x${"b".repeat(64)}` });
});
async function stock({ confirmed = false, released = true } = {}) {
  const batchId = `OPS-${++sequence}`, shipmentId = `OPS-SHIP-${sequence}`;
  await Batch.create({ batchId, quantity: 20, vaccineType: "Synthetic product", manufacturer: "Synthetic Maker", productionApproved: released, labApproved: released, releaseVisibleToExternal: released, reportStatus: "Reported", expiresAt: new Date("2099-01-01") });
  await Shipment.create({ batchId, shipmentId, quantity: 10, vaccineType: "Synthetic product", distributor: distributor.distributor, destination: hospital.hospital, status: confirmed ? "Delivery Confirmed by Hospital" : "New Shipment Required", hospitalConfirmed: confirmed });
  if (confirmed) await Vaccination.create({ batchId, shipmentId, vaccineType: "Synthetic product", hospital: hospital.hospital, centerId: hospital.hospital, receivedDoses: 10, eventType: "Delivery Confirmation", workflowStage: "1.2 Stock Management" });
  return { batchId, shipmentId };
}

test("verify, dispatch, supply, and receipt run in order and repeat supply/receipt do not duplicate inventory", async () => {
  const item = await stock();
  expect((await patch(`distributor/supply/${item.shipmentId}`, distributor)).status).toBe(409);
  expect((await patch(`healthcare/confirm/${item.shipmentId}`, hospital)).status).toBe(409);
  expect((await patch(`distributor/status/${item.shipmentId}`, distributor, { status: "In Transit" })).status).toBe(409);
  expect((await patch(`distributor/verify/${item.shipmentId}`, distributor)).status).toBe(200);
  expect((await patch(`distributor/status/${item.shipmentId}`, distributor, { status: "Invented" })).status).toBe(400);
  expect((await patch(`distributor/status/${item.shipmentId}`, distributor, { status: "In Transit" })).status).toBe(200);
  expect((await patch(`distributor/supply/${item.shipmentId}`, distributor)).status).toBe(200);
  expect((await patch(`distributor/supply/${item.shipmentId}`, distributor)).body.alreadySupplied).toBe(true);
  expect(await Distribution.countDocuments({ batchId: item.batchId })).toBe(1);
  expect((await patch(`healthcare/confirm/${item.shipmentId}`, hospital)).status).toBe(200);
  expect((await patch(`healthcare/confirm/${item.shipmentId}`, hospital)).body.alreadyConfirmed).toBe(true);
  expect(await Vaccination.countDocuments({ batchId: item.batchId, eventType: "Delivery Confirmation" })).toBe(1);
  expect((await patch(`distributor/status/${item.shipmentId}`, distributor, { status: "In Transit" })).status).toBe(409);
});

test("unreleased batches and wrong organizations cannot progress shipment actions", async () => {
  const item = await stock({ released: false });
  expect((await patch(`distributor/verify/${item.shipmentId}`, distributor)).status).toBe(409);
  expect((await patch(`healthcare/confirm/${item.shipmentId}`, outsider)).status).toBe(403);
  expect(chain.logLifecycleEventOnChain).not.toHaveBeenCalled();
});

test.each(["administer", "workflow", "create"])("%s rejects unconfirmed or forged stock", async path => {
  const item = await stock();
  const result = await post(path, { batchId: item.batchId, dosesUsed: 1, stockBefore: 10000, receivedDoses: 10000 });
  expect(result.status).toBe(409);
  expect(await Vaccination.countDocuments({ batchId: item.batchId })).toBe(0);
  expect(chain.logLifecycleEventOnChain).not.toHaveBeenCalled();
});

test("administration uses confirmed stock, respects remaining doses, and preserves manufactured quantity", async () => {
  const item = await stock({ confirmed: true });
  const first = await post("administer", { batchId: item.batchId, dosesUsed: 7, stockBefore: 999, patientName: "Synthetic patient" });
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ stockBefore: 10, stockAfter: 3, dosesUsed: 7, vaccineType: "Synthetic product" });
  expect((await Batch.findOne({ batchId: item.batchId })).quantity).toBe(20);
  expect((await post("administer", { batchId: item.batchId, dosesUsed: 4, stockBefore: 999 })).status).toBe(409);
  expect((await post("administer", { batchId: item.batchId, dosesUsed: -1 })).status).toBe(400);
  expect((await post("administer", { batchId: item.batchId, dosesUsed: 1.5 })).status).toBe(400);
});

test("workflow records administration/report without minting client-supplied inventory", async () => {
  const item = await stock({ confirmed: true });
  const result = await post("workflow", { batchId: item.batchId, dosesUsed: 2, receivedDoses: 800, requestedDoses: 800, stockBefore: 900, patientName: "Synthetic patient", healthAuthority: "Demo authority" });
  expect(result.status).toBe(200);
  expect(result.body.inventory).toMatchObject({ receivedDoses: 0, stockBefore: 10, stockAfter: 10 });
  expect(result.body.administration).toMatchObject({ dosesUsed: 2, stockBefore: 10, stockAfter: 8 });
  expect(result.body.report.recordStatus).toBe("Reported");
});

test("legacy inventory and create cannot forge receipts or arbitrary vaccination records", async () => {
  const item = await stock({ confirmed: true });
  const before = await Vaccination.countDocuments({ batchId: item.batchId });
  expect((await post("inventory", { ...item, receivedDoses: 1000 })).body.alreadyRecorded).toBe(true);
  expect((await post("create", { batchId: item.batchId, eventType: "Unknown", receivedDoses: 1000 })).status).toBe(400);
  expect((await post("report", { batchId: item.batchId, dosesUsed: 1 })).status).toBe(400);
  expect(await Vaccination.countDocuments({ batchId: item.batchId })).toBe(before);
});

test("concurrent requests cannot spend the same confirmed doses twice", async () => {
  const item = await stock({ confirmed: true });
  const results = await Promise.all([post("administer", { batchId: item.batchId, dosesUsed: 7 }), post("administer", { batchId: item.batchId, dosesUsed: 7 })]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
});

test("mismatched shipment products cannot pass verification or other progression", async () => {
  const item = await stock();
  await Shipment.updateOne({ shipmentId: item.shipmentId }, { vaccineType: "Different product" });
  expect((await patch(`distributor/verify/${item.shipmentId}`, distributor)).status).toBe(409);
  expect(chain.logLifecycleEventOnChain).not.toHaveBeenCalled();
});

test("failed final chain work does not publish a false shipment state", async () => {
  const item = await stock();
  chain.updateBatchStatusOnChain.mockRejectedValueOnce(new Error("Synthetic chain failure"));
  expect((await patch(`distributor/verify/${item.shipmentId}`, distributor)).status).toBe(500);
  expect((await Shipment.findOne({ shipmentId: item.shipmentId })).status).toBe("New Shipment Required");
  expect((await patch(`distributor/verify/${item.shipmentId}`, distributor)).status).toBe(200);
});

test("a failed final supply save retries without a duplicate distribution", async () => {
  const item = await stock();
  await Shipment.updateOne({ shipmentId: item.shipmentId }, { status: "In Transit" });
  jest.spyOn(Shipment.prototype, "save").mockRejectedValueOnce(new Error("Synthetic final save failure"));
  expect((await patch(`distributor/supply/${item.shipmentId}`, distributor)).status).toBe(500);
  expect((await Shipment.findOne({ shipmentId: item.shipmentId })).status).toBe("In Transit");
  expect((await patch(`distributor/supply/${item.shipmentId}`, distributor)).status).toBe(200);
  expect(await Distribution.countDocuments({ shipmentId: item.shipmentId })).toBe(1);
});

test("partial confirmation stays visible and retries with one receipt and notification", async () => {
  const item = await stock();
  await Shipment.updateOne({ shipmentId: item.shipmentId }, { status: "Supplied to Vaccination Center" });
  jest.spyOn(Notification, "findOneAndUpdate").mockRejectedValueOnce(new Error("Synthetic notification failure"));
  expect((await patch(`healthcare/confirm/${item.shipmentId}`, hospital)).status).toBe(500);
  expect((await Shipment.findOne({ shipmentId: item.shipmentId })).hospitalConfirmed).toBe(false);
  expect((await post("administer", { batchId: item.batchId, dosesUsed: 1 })).status).toBe(409);
  expect((await patch(`healthcare/confirm/${item.shipmentId}`, hospital)).status).toBe(200);
  expect(await Vaccination.countDocuments({ shipmentId: item.shipmentId, eventType: "Delivery Confirmation" })).toBe(1);
  expect(await Notification.countDocuments({ orderId: item.shipmentId, title: "Hospital Delivery Confirmed" })).toBe(1);
});

test("replaying a completed vaccination operation returns the previous result without more debits", async () => {
  const item = await stock({ confirmed: true });
  const body = { batchId: item.batchId, dosesUsed: 2, operationId: "completed-operation", patientName: "Synthetic reference", healthAuthority: "Demo authority" };
  expect((await post("workflow", body)).status).toBe(200);
  const replay = await post("workflow", body);
  expect(replay.status).toBe(200);
  expect(replay.body.alreadyRecorded).toBe(true);
  expect(await Vaccination.countDocuments({ batchId: item.batchId, eventType: "Vaccination" })).toBe(1);
  expect((await post("workflow", { ...body, dosesUsed: 3 })).status).toBe(409);
});

test("a vaccination debit followed by chain failure blocks duplicate operation retries", async () => {
  const item = await stock({ confirmed: true });
  const body = { batchId: item.batchId, dosesUsed: 2, operationId: "interrupted-operation", patientName: "Synthetic reference" };
  chain.logLifecycleEventOnChain.mockImplementation(async ({ action }) => {
    if (action === "Administer Vaccines") throw new Error("Synthetic chain interruption");
    return { hash: `0x${"b".repeat(64)}` };
  });
  expect((await post("workflow", body)).status).toBe(500);
  const retry = await post("workflow", body);
  expect(retry.status).toBe(409);
  expect(retry.body.code).toBe("VACCINATION_OPERATION_INCOMPLETE");
  expect(await Vaccination.countDocuments({ batchId: item.batchId, eventType: "Vaccination" })).toBe(1);
});
