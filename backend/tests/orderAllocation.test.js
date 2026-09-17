jest.mock("../services/blockchainService", () => ({ logLifecycleEventOnChain: jest.fn(), extractHash: receipt => receipt?.hash || "" }));
const express = require("express");
const request = require("supertest");
const Batch = require("../models/Batch");
const Shipment = require("../models/Shipment");
const Order = require("../models/Order");
const User = require("../models/user");
const Alert = require("../models/TemperatureAlert");
const Notification = require("../models/Notification");
const { issueToken } = require("../middleware/auth");
const { logLifecycleEventOnChain } = require("../services/blockchainService");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const app = express();
app.use(express.json());
app.use("/api/orders", require("../routes/orderRoutes"));
let f, order, maker, distributor;
const bearer = user => ({ Authorization: `Bearer ${issueToken({ id: user._id, role: "admin" })}` });
const review = (body = {}, user = f.reviewer, id = order.orderId) => request(app).patch(`/api/orders/${id}/review`)
  .set(bearer(user)).send({ decision: "Approve", batchId: f.batchId, distributor: distributor.distributor, ...body });
beforeAll(connect, 15000);
afterAll(close);
beforeEach(async () => {
  jest.restoreAllMocks();
  logLifecycleEventOnChain.mockReset().mockResolvedValue({ hash: `0x${"a".repeat(64)}`, status: 1 });
  f = await fixture();
  await Batch.updateOne({ batchId: f.batchId }, { $set: { vaccineType: f.batchId, releaseVisibleToExternal: true,
    productionApproved: true, labApproved: true, reportStatus: "Reported" } });
  await Shipment.updateOne({ shipmentId: f.shipmentId }, { $set: { quantity: 0, vaccineType: f.batchId } });
  [maker, distributor] = await User.create([
    { email: `maker-${f.batchId}@test`, password: "test", role: "manufacturer", manufacturer: "maker-a" },
    { email: `dist-${f.batchId}@test`, password: "test", role: "distributor", distributor: `dist-${f.batchId}` },
  ]);
  order = await Order.create({ orderId: `ORD-${f.batchId}`, auditBatchId: `ORDER-${f.batchId}`, hospital: "hospital-a",
    vaccineType: f.batchId, requestedDoses: 60 });
});

test("approval links a real batch, records allocation, and logs the real batch on chain", async () => {
  const response = await review();
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ status: "Approved", allocatedBatchId: f.batchId, auditBatchId: order.auditBatchId });
  const shipment = await Shipment.findOne({ orderId: order.orderId });
  expect(shipment.batchId).toBe(f.batchId);
  expect(shipment.quantity).toBe(60);
  expect(logLifecycleEventOnChain).toHaveBeenCalledWith(expect.objectContaining({ batchId: f.batchId }));
});

test("anonymous and non-admin requests cannot approve, even with the bypass enabled or an admin token claim", async () => {
  process.env.AUTH_OPTIONAL = "true";
  try {
    expect((await request(app).patch(`/api/orders/${order.orderId}/review`).send({ decision: "Approve" })).status).toBe(401);
    expect((await review({}, maker)).status).toBe(403);
    expect((await request(app).get("/api/orders/admin").set(bearer(maker))).status).toBe(403);
  } finally { delete process.env.AUTH_OPTIONAL; }
  expect(logLifecycleEventOnChain).not.toHaveBeenCalled();
});

test("allocation inputs must name a real batch and mapped distributor", async () => {
  expect((await review({ batchId: "" })).body.code).toBe("ALLOCATION_REQUIRED");
  expect((await review({ batchId: "missing" })).body.code).toBe("BATCH_NOT_FOUND");
  expect((await review({ distributor: "unmapped" })).body.code).toBe("DISTRIBUTOR_NOT_MAPPED");
  expect(logLifecycleEventOnChain).not.toHaveBeenCalled();
});

test.each([
  [{ vaccineType: "other" }, "VACCINE_MISMATCH"],
  [{ manufacturer: "Unknown" }, "BATCH_INELIGIBLE"],
  [{ releaseVisibleToExternal: false }, "BATCH_INELIGIBLE"],
  [{ labApproved: false }, "BATCH_INELIGIBLE"],
  [{ quantity: 59 }, "INSUFFICIENT_STOCK"],
  [{ coldChainHoldAlertIds: ["hold"] }, "COLD_CHAIN_HOLD"],
])("rejects invalid/ineligible batch updates %j", async (update, code) => {
  await Batch.updateOne({ batchId: f.batchId }, { $set: update });
  expect((await review()).body.code).toBe(code);
  expect(await Shipment.countDocuments({ orderId: order.orderId })).toBe(0);
  expect(logLifecycleEventOnChain).not.toHaveBeenCalled();
});

test("checks shipment holds and partially applied alert holds", async () => {
  await Shipment.updateOne({ shipmentId: f.shipmentId }, { $set: { coldChainHoldAlertIds: ["hold"] } });
  expect((await review()).body.code).toBe("COLD_CHAIN_HOLD");
  await Shipment.updateOne({ shipmentId: f.shipmentId }, { $set: { coldChainHoldAlertIds: [] } });
  await Alert.create({ batchId: f.batchId, violationType: "HIGH_TEMPERATURE", severity: "CRITICAL", reason: "Synthetic fixture",
    timestamp: f.at(0), excursionStartedAt: f.at(0), latestReadingAt: f.at(0), requiresQualityReview: true });
  expect((await review()).body.code).toBe("COLD_CHAIN_HOLD");
});

test("repeated approvals are idempotent and changing an approved decision conflicts", async () => {
  const responses = await Promise.all([review(), review()]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  expect(await Shipment.countDocuments({ orderId: order.orderId })).toBe(1);
  expect(await Notification.countDocuments({ orderId: order.orderId })).toBe(2);
  expect(logLifecycleEventOnChain).toHaveBeenCalledTimes(1);
  expect((await review({ decision: "Decline" })).body.code).toBe("ORDER_ALREADY_REVIEWED");
});

test("concurrent orders cannot allocate the same remaining doses", async () => {
  const second = await Order.create({ orderId: `SECOND-${f.batchId}`, auditBatchId: `AUDIT-${f.batchId}`,
    hospital: "hospital-a", vaccineType: f.batchId, requestedDoses: 60 });
  const responses = await Promise.all([review(), review({}, f.reviewer, second.orderId)]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect(await Shipment.countDocuments({ batchId: f.batchId, quantity: 60 })).toBe(1);
});

test("order-save failure retains reservation; retry recovers without another shipment or chain write", async () => {
  await Order.updateOne({ _id: order._id }, { $set: { requestedDoses: 100 } });
  const realSave = Order.prototype.save;
  const save = jest.spyOn(Order.prototype, "save").mockImplementationOnce(async function () { throw new Error("Injected save failure"); })
    .mockImplementation(realSave);
  expect((await review()).status).toBe(500);
  expect(await Shipment.countDocuments({ orderId: order.orderId })).toBe(1);
  expect((await review()).status).toBe(200);
  expect(logLifecycleEventOnChain).toHaveBeenCalledTimes(1);
  save.mockRestore();
});

test("notification failure is retryable without duplicating stock or notifications", async () => {
  jest.spyOn(Notification, "updateOne").mockRejectedValueOnce(new Error("Injected notification failure"));
  expect((await review()).status).toBe(500);
  expect((await review()).status).toBe(200);
  expect(await Notification.countDocuments({ orderId: order.orderId })).toBe(2);
  expect(logLifecycleEventOnChain).toHaveBeenCalledTimes(1);
});

test("chain failure leaves the order pending without a new shipment; mock hashes are not marked verified", async () => {
  logLifecycleEventOnChain.mockRejectedValueOnce(new Error("RPC offline"));
  expect((await review()).status).toBe(500);
  expect((await Order.findById(order._id)).status).toBe("Pending");
  expect(await Shipment.countDocuments({ orderId: order.orderId })).toBe(0);
  logLifecycleEventOnChain.mockResolvedValueOnce({ hash: "0xmock..." });
  const response = await review();
  expect(response.body.approvalTxHash).toBe("");
  expect(response.body.blockchainStatus).toContain("unverified");
});

test("legacy unallocated approvals and mismatched existing shipments require reconciliation", async () => {
  await Order.updateOne({ _id: order._id }, { $set: { status: "Approved" } });
  expect((await review()).body.code).toBe("ORDER_ALREADY_REVIEWED");
  await Order.updateOne({ _id: order._id }, { $set: { status: "Pending" } });
  await Shipment.create({ shipmentId: `SHIP-${order.orderId}`, batchId: f.batchId, quantity: 10, vaccineType: f.batchId });
  expect((await review()).body.code).toBe("SHIPMENT_CONFLICT");
});

test("orphan shipments, duplicate batch IDs and unknown shipment quantities fail closed", async () => {
  const orphan = await Shipment.create({ shipmentId: `ORPHAN-${f.batchId}`, batchId: `MISSING-${f.batchId}`, vaccineType: f.batchId, quantity: 10 });
  expect((await review()).body.error).toContain("UNRECONCILED_SHIPMENTS");
  await Shipment.updateOne({ _id: orphan._id }, { $set: { batchId: f.batchId }, $unset: { quantity: 1 } });
  expect((await review()).body.error).toContain("INVALID_STOCK_RECORDS");
  await Batch.create({ batchId: f.batchId, vaccineType: f.batchId });
  expect((await review()).body.error).toContain("AMBIGUOUS_BATCH_ID");
});

test("decline does not require inventory and can be retried", async () => {
  expect((await review({ decision: "Decline", batchId: "", distributor: "" })).status).toBe(200);
  expect((await review({ decision: "Decline" })).status).toBe(200);
  expect(await Notification.countDocuments({ orderId: order.orderId })).toBe(1);
  expect(logLifecycleEventOnChain).not.toHaveBeenCalled();
});

test("admin options report remaining doses and mapped distributor identities", async () => {
  await review();
  const response = await request(app).get("/api/orders/admin").set(bearer(f.reviewer));
  expect(response.status).toBe(200);
  expect(response.body.allocationOptions.find(b => b.batchId === f.batchId)).toMatchObject({ remainingDoses: 40, assignedDoses: 60 });
  expect(response.body.distributors).toContain(distributor.distributor);
});
