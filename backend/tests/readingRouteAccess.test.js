const express = require("express");
const request = require("supertest");

jest.mock("../middleware/auth", () => {
  const actual = jest.requireActual("../middleware/auth");
  return { ...actual, authenticate(req, _res, next) { req.user = { role: req.get("x-test-role") || "" }; next(); } };
});
jest.mock("../controllers/manualReadingController", () => ({
  createManualReading: (_req, res) => res.status(202).json({ accepted: true }),
  correctReading: (_req, res) => res.status(202).json({ accepted: true }),
  importReadings: (_req, res) => res.status(202).json({ accepted: true }),
}));

const app = express();
app.use(express.json());
app.use("/api/readings", require("../routes/readingRoutes"));

test("Admin is authorized to create and correct manual readings", async () => {
  const created = await request(app).post("/api/readings/manual").set("x-test-role", "admin").send({});
  const corrected = await request(app).post("/api/readings/reading-id/correct").set("x-test-role", "admin").send({});
  expect(created.status).toBe(202);
  expect(corrected.status).toBe(202);
});

test("unrelated Manufacturer role receives 403 for manual create and correction", async () => {
  const created = await request(app).post("/api/readings/manual").set("x-test-role", "manufacturer").send({});
  const corrected = await request(app).post("/api/readings/reading-id/correct").set("x-test-role", "manufacturer").send({});
  expect(created.status).toBe(403);
  expect(corrected.status).toBe(403);
});
