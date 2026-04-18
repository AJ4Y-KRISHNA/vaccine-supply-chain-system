const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../server");

describe("Dashboard endpoints", () => {
  beforeAll(async () => {
    const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/vaccineDB_test";
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  test("GET /api/dashboard/distributor returns totals and shipments", async () => {
    const res = await request(app).get("/api/dashboard/distributor");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totals");
    expect(res.body).toHaveProperty("shipments");
  });

  test("GET /api/dashboard/manufacturer returns cards and batches", async () => {
    const res = await request(app).get("/api/dashboard/manufacturer");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cards");
    expect(res.body).toHaveProperty("batches");
  });

  test("GET /api/dashboard/healthcare returns cards and usage logs", async () => {
    const res = await request(app).get("/api/dashboard/healthcare");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cards");
    expect(res.body).toHaveProperty("usageLogs");
  });
});
