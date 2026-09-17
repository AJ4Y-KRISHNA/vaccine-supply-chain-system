const mongoose = require("mongoose");
const { planReconciliation, applyReconciliation, VERSION } = require("../services/demoReconciliationService");
const Journal = require("../models/DemoReconciliation");
const { connect, close } = require("./helpers/coldChainFixture");
beforeAll(connect, 15000); afterAll(close);
const id = () => new mongoose.Types.ObjectId();
function sample() {
  return { batches: [{ _id: id(), batchId: "OLD", manufacturer: "Unknown", quantity: 0, coldChainHoldAlertIds: ["retained"] }],
    shipments: [{ _id: id(), shipmentId: "SHIP-O1", batchId: "MISSING", distributor: "Legacy distributor", destination: "Legacy hospital" }],
    logs: [{ _id: id(), batchId: "MISSING", temperature: 10, recordedAt: new Date("2026-01-01") }],
    orders: [{ _id: id(), orderId: "O1", auditBatchId: "ORDER-O1", status: "Approved", hospital: "Legacy hospital" }],
    users: [{ _id: id(), role: "manufacturer", manufacturer: "Demo maker", email: "maker@test" },
      { _id: id(), role: "distributor", email: "dist@test" }, { _id: id(), role: "healthcare", email: "hospital@test" }] };
}
test("demo plan preserves original IDs and holds; missing facts are explicit zero-dose placeholders", () => {
  const data = sample(), before = JSON.stringify(data);
  const ops = planReconciliation(data);
  expect(JSON.stringify(data)).toBe(before);
  const batch = ops.find(o => o.before === null).after;
  expect(batch).toMatchObject({ batchId: "MISSING", quantity: 0, isDemo: true, releaseVisibleToExternal: false });
  expect(batch.demoProvenance.placeholderFields).toContain("syntheticBatch");
  expect(ops.find(o => String(o.targetId) === String(data.batches[0]._id)).after.coldChainHoldAlertIds).toBeUndefined();
  expect(ops.find(o => o.targetCollection === "temperaturelogs").after.temperature).toBeUndefined();
  expect(ops.find(o => o.targetCollection === "orders").after).toMatchObject({ allocatedBatchId: "MISSING", shipmentId: "SHIP-O1" });
});
test("applying and retrying is idempotent and retains journal before-images", async () => {
  const data = sample();
  for (const [name, key] of [["batches", "batches"], ["shipments", "shipments"], ["temperaturelogs", "logs"], ["orders", "orders"], ["users", "users"]])
    await mongoose.connection.collection(name).insertMany(data[key]);
  const ops = planReconciliation(data);
  await applyReconciliation(mongoose.connection, ops, Journal);
  await applyReconciliation(mongoose.connection, ops, Journal);
  expect(await Journal.countDocuments()).toBe(ops.length);
  expect((await Journal.findOne({ targetId: data.batches[0]._id })).before.manufacturer).toBe("Unknown");
  expect((await mongoose.connection.collection("batches").findOne({ _id: data.batches[0]._id })).coldChainHoldAlertIds).toEqual(["retained"]);
  const updated = {};
  for (const [name, key] of [["batches", "batches"], ["shipments", "shipments"], ["temperaturelogs", "logs"], ["orders", "orders"], ["users", "users"]]) updated[key] = await mongoose.connection.collection(name).find().toArray();
  expect(planReconciliation(updated)).toEqual([]);
  expect(updated.batches.every(b => b.demoProvenance.version === VERSION)).toBe(true);
});
test("ambiguous accounts or batch identifiers fail before applying changes", () => {
  const data = sample(); data.users.push({ _id: id(), role: "manufacturer" });
  expect(() => planReconciliation(data)).toThrow("exactly one");
  data.users.pop(); data.batches.push({ _id: id(), batchId: "OLD" });
  expect(() => planReconciliation(data)).toThrow("Ambiguous");
});
