const { planSupply } = require("../services/supplyPlanner");
const base = () => ({ asOf: "2030-01-01", transportCapacityDoses: 80,
  inventory: ["A", "B"].map((batchId, i) => ({ batchId, vaccineType: "TEST", remainingDoses: 60, reasons: [], expiresAt: `2030-01-0${i + 2}` })),
  orders: ["O1", "O2"].map(orderId => ({ orderId, hospital: orderId, vaccineType: "TEST", requestedDoses: 60, status: "Pending", priority: "Normal" })),
  destinations: ["O1", "O2"].map(orderId => ({ orderId, freeCapacityDoses: 50, transitHours: 1 })) });
test("deterministic constrained optimizer honors demand, shared stock, transport and destination capacity", () => {
  const args = base(), plan = planSupply(args);
  expect(plan).toEqual(planSupply(args));
  expect(plan.totalAllocated).toBe(80);
  expect(plan.optimizationStatus).toBe("OPTIMAL_MAX_FLOW");
  expect(plan).not.toHaveProperty("advisoryOnly");
  expect(plan.allocations.map(a => [a.batchId, a.quantity])).toEqual([["A", 50], ["A", 10], ["B", 20]]);
  expect(plan.unfilled.map(u => u.doses)).toEqual([10, 30]);
  expect(args.inventory[0].remainingDoses).toBe(60); // Pure advisory; no stock mutation.
});
test("global optimization favors the shorter feasible route when priority is equal", () => {
  const args = base();
  args.transportCapacityDoses = 10;
  args.inventory = [{ batchId: "A", vaccineType: "TEST", remainingDoses: 20, reasons: [], expiresAt: "2030-01-02" }];
  args.destinations = [{ orderId: "O1", freeCapacityDoses: 20, transitHours: 10 }, { orderId: "O2", freeCapacityDoses: 20, transitHours: 1 }];
  const plan = planSupply(args);
  expect(plan.totalAllocated).toBe(10);
  expect(plan.allocations.map(item => item.orderId)).toEqual(["O2"]);
  expect(plan.algorithm).toBe("constrained-min-cost-max-flow-v1");
  expect(plan.explanation).toContain("minimum-cost maximum-flow");
});
test("higher order priority remains ahead of shorter route when vehicle capacity is scarce", () => {
  const args = base();
  args.transportCapacityDoses = 10;
  args.inventory = [{ batchId: "A", vaccineType: "TEST", remainingDoses: 20, reasons: [], expiresAt: "2030-01-02" }];
  args.orders[0].priority = "Critical";
  args.orders[1].priority = "Low";
  args.destinations = [{ orderId: "O1", freeCapacityDoses: 20, transitHours: 10 }, { orderId: "O2", freeCapacityDoses: 20, transitHours: 1 }];
  const plan = planSupply(args);
  expect(plan.allocations.map(item => item.orderId)).toEqual(["O1"]);
});
test("excludes holds, unreleased, missing/expired shelf life and wrong product", () => {
  for (const update of [{ reasons: ["COLD_CHAIN_HOLD"] }, { reasons: ["BATCH_NOT_RELEASED"] }, { expiresAt: null }, { expiresAt: "2029-01-01" }, { vaccineType: "OTHER" }]) {
    const args = base(); args.inventory = [{ ...args.inventory[0], ...update }];
    expect(planSupply(args).totalAllocated).toBe(0);
  }
  const args = base(); args.destinations.forEach(d => d.transitHours = 72);
  expect(planSupply(args).totalAllocated).toBe(0);
});
test("same hospital capacity is shared across orders and products", () => {
  const args = base(); args.orders.forEach(o => o.hospital = "Shared hospital");
  expect(planSupply(args).totalAllocated).toBe(50);
  args.destinations[1].freeCapacityDoses = 99;
  expect(() => planSupply(args)).toThrow(/same shared/);
});
test("rejects invalid constraints and duplicate/nonpending orders", () => {
  for (const value of [-1, 1.5, "5", NaN]) expect(() => planSupply({ ...base(), transportCapacityDoses: value })).toThrow();
  const args = base(); args.destinations.push(args.destinations[0]); expect(() => planSupply(args)).toThrow(/Duplicate/);
  args.destinations.pop(); args.orders[0].status = "Approved"; expect(() => planSupply(args)).toThrow(/pending/);
});
test("repeatable varied-capacity trials never exceed any hard constraint", () => {
  for (let i = 0; i < 100; i++) {
    const args = base(); args.transportCapacityDoses = (i * 17) % 150;
    args.destinations.forEach((d, j) => d.freeCapacityDoses = (i * 13 + j) % 90);
    const plan = planSupply(args);
    expect(plan.totalAllocated).toBeLessThanOrEqual(args.transportCapacityDoses);
    for (const batch of args.inventory) expect(plan.allocations.filter(a => a.batchId === batch.batchId).reduce((s, a) => s + a.quantity, 0)).toBeLessThanOrEqual(batch.remainingDoses);
    for (const order of args.orders) expect(plan.allocations.filter(a => a.orderId === order.orderId).reduce((s, a) => s + a.quantity, 0)).toBeLessThanOrEqual(Math.min(order.requestedDoses, args.destinations.find(d => d.orderId === order.orderId).freeCapacityDoses));
  }
});
