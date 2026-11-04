const { buildIntegrityReport } = require("../services/dataIntegrityService");
const { assessBatch } = require("../services/inventoryEligibility");

test("audit reports broken references without changing the input records", () => {
  const data = { batches: [{ _id: "b1", batchId: "B1", manufacturer: "Unknown" }],
    shipments: [{ _id: "s1", shipmentId: "S1", batchId: "MISSING" }],
    logs: [{ _id: "t1", batchId: "MISSING", shipmentId: "S1" }, { _id: "t2", batchId: "B1", shipmentId: "S1" }],
    orders: [{ orderId: "O1", status: "Approved", auditBatchId: "ORDER-O1" }], users: [] };
  const before = JSON.stringify(data);
  const report = buildIntegrityReport(data);
  expect(report.readOnly).toBe(true);
  expect(report.issueCounts).toMatchObject({ orphanShipments: 1, orphanTelemetry: 1, conflictingTelemetry: 1, unknownOwners: 1, unallocatedApprovedOrders: 1 });
  expect(JSON.stringify(data)).toBe(before);
});

test("known owner names are compared case-insensitively; duplicate identifiers are reported", () => {
  const report = buildIntegrityReport({ batches: [{ _id: "1", batchId: "B", manufacturer: " Maker " }, { _id: "2", batchId: "B", manufacturer: "Maker" }],
    users: [{ role: "manufacturer", manufacturer: "maker" }], shipments: [], logs: [], orders: [] });
  expect(report.issueCounts.unknownOwners).toBe(0);
  expect(report.issues.duplicateBatchIds).toEqual([{ batchId: "B", ids: ["1", "2"] }]);
});

test("allocation never assumes unknown quantities or silently returns cancelled shipment stock", () => {
  const batch = { batchId: "B", manufacturer: "maker", quantity: 100, releaseVisibleToExternal: true, productionApproved: true, labApproved: true, reportStatus: "Reported" };
  const result = assessBatch(batch, [{ batchId: "B", quantity: 60, status: "Cancelled" }], [], [{ manufacturer: "maker" }]);
  expect(result).toMatchObject({ eligible: true, remainingDoses: 40 });
  expect(assessBatch({ ...batch, disposition: { status: "recalled" } }, [], [], [{ manufacturer: "maker" }]).reasons).toContain("BATCH_DISPOSITION_RECALLED");
  expect(assessBatch(batch, [{ batchId: "B" }], [], [{ manufacturer: "maker" }]).reasons).toContain("INVALID_STOCK_RECORDS");
});
