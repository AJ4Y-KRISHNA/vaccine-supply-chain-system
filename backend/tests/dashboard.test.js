const request = require("supertest");
const express = require("express");
const { connect, close, fixture } = require("./helpers/coldChainFixture");
const { issueToken } = require("../middleware/auth");
const app = express();
app.use("/api/dashboard", require("../routes/dashboardRoutes"));
let auth;

describe("Dashboard endpoints", () => {
  beforeAll(async () => {
    await connect();
    const f = await fixture();
    auth = { Authorization: `Bearer ${issueToken({ id: f.reviewer._id, role: "admin" })}` };
  });

  afterAll(async () => {
    await close();
  });

  test("GET /api/dashboard/distributor returns totals and shipments", async () => {
    const res = await request(app).get("/api/dashboard/distributor").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totals");
    expect(res.body).toHaveProperty("shipments");
  });

  test("GET /api/dashboard/manufacturer returns cards and batches", async () => {
    const res = await request(app).get("/api/dashboard/manufacturer").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cards");
    expect(res.body).toHaveProperty("batches");
  });

  test("GET /api/dashboard/healthcare returns cards and usage logs", async () => {
    const res = await request(app).get("/api/dashboard/healthcare").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cards");
    expect(res.body).toHaveProperty("usageLogs");
  });
});
