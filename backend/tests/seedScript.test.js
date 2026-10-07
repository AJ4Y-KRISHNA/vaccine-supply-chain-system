const { buildSyntheticOrderHistory, demoUsers, demoBatches } = require("../scripts/seed");

test("seed fixtures contain one synthetic login identity per role and three batches", () => {
  expect(demoUsers.map(user => user.role).sort()).toEqual(["admin", "distributor", "field_operator", "healthcare", "manufacturer"]);
  expect(demoBatches).toHaveLength(3);
  expect(demoUsers.every(user => user.email.endsWith("@demo.synthetic.test"))).toBe(true);
});

test("seed fixture generates 36 synthetic months per batch with seasonal and campaign variation", () => {
  const rows = buildSyntheticOrderHistory({ now: new Date("2026-10-05T12:00:00.000Z") });
  expect(rows).toHaveLength(36 * 3);
  expect(new Set(rows.map(row => row.createdAt.toISOString().slice(0, 7))).size).toBe(36);
  expect(new Set(rows.map(row => row.vaccineType)).size).toBe(3);
  expect(rows.every(row => row.isDemo === true && row.demoProvenance.nature === "synthetic" && row.requestedDoses > 0)).toBe(true);
  expect(rows.some(row => row.notes.includes("campaign=1.75"))).toBe(true);
  expect(new Set(rows.map(row => row.requestedDoses)).size).toBeGreaterThan(3);
});
