const request = require("supertest");
const { createEdgeGatewayApp, safeEqual, validateUpstreamUrl } = require("../edge-gateway/app");
const { signDeviceTelemetry } = require("../edge-gateway/deviceAuth");

const validReading = {
  shipmentId: "SHIP-EDGE-01", batchId: "BATCH-EDGE-01", deviceId: "DEVICE-EDGE-01",
  vehicleId: "TRUCK-EDGE-01", temperature: 5.2, humidity: 58, batteryLevel: 92,
  recordedAt: new Date(Date.now() - 60 * 1000).toISOString(), location: { lat: 9.9312, lng: 76.2673 },
  source: "auto-simulated", simulation: { source: "software-iot-simulator", tick: 1 },
};

describe("separate Edge Gateway HTTP ingestion", () => {
  test("authenticates, validates, adds correlation metadata, and forwards to backend", async () => {
    const forward = jest.fn(async (readings, context) => [{ _id: "persisted-edge-reading", ...readings[0], context }]);
    const app = createEdgeGatewayApp({ apiKey: "edge-test-key", forward });
    const response = await request(app).post("/ingest").set("x-api-key", "edge-test-key")
      .set("x-correlation-id", "edge.acceptance.1").send(validReading).expect(200);

    expect(response.body[0]._id).toBe("persisted-edge-reading");
    expect(response.headers["x-correlation-id"]).toBe("edge.acceptance.1");
    expect(forward).toHaveBeenCalledWith([expect.objectContaining({
      batchId: "BATCH-EDGE-01", correlationId: "edge.acceptance.1",
    })], { correlationId: "edge.acceptance.1", transport: "http" });
  });

  test("rejects unauthenticated and invalid telemetry before forwarding", async () => {
    const forward = jest.fn();
    const app = createEdgeGatewayApp({ apiKey: "edge-test-key", forward });
    await request(app).post("/ingest").send(validReading).expect(401);
    await request(app).post("/ingest").set("x-api-key", "edge-test-key")
      .send({ ...validReading, temperature: 101 }).expect(400);
    expect(forward).not.toHaveBeenCalled();
  });

  test("maps upstream failures to a safe gateway response", async () => {
    const forward = jest.fn().mockRejectedValue(new Error("private upstream detail"));
    const app = createEdgeGatewayApp({ apiKey: "edge-test-key", forward });
    const response = await request(app).post("/ingest").set("x-api-key", "edge-test-key")
      .send(validReading).expect(502);
    expect(response.body).toEqual({ error: "Telemetry could not be forwarded to the backend" });
  });

  test("allows only credential-free loopback HTTP or HTTPS upstreams", () => {
    expect(validateUpstreamUrl("http://127.0.0.1:5000/api/temperature/ingest"))
      .toBe("http://127.0.0.1:5000/api/temperature/ingest");
    expect(() => validateUpstreamUrl("http://remote.example.test/ingest")).toThrow("must use loopback HTTP or HTTPS");
    expect(() => validateUpstreamUrl("https://user:secret@127.0.0.1/ingest")).toThrow("without embedded credentials");
  });

  test("compares API keys without accepting unequal lengths", () => {
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("same", "same-longer")).toBe(false);
    expect(safeEqual("same", undefined)).toBe(false);
  });

  test("requires an HMAC bound to the telemetry's device identity when device auth is enabled", async () => {
    const forward = jest.fn(async rows => [{ _id: "signed-reading", ...rows[0] }]);
    const app = createEdgeGatewayApp({ apiKey: "gateway-key", deviceSecret: "device-secret", requireDeviceSignature: true, forward });
    await request(app).post("/ingest").set("x-api-key", "gateway-key").send(validReading).expect(401);
    const signature = signDeviceTelemetry("device-secret", validReading);
    await request(app).post("/ingest").set("x-api-key", "gateway-key").set("x-device-id", validReading.deviceId)
      .set("x-device-signature", signature).send(validReading).expect(200);
    expect(forward).toHaveBeenCalledTimes(1);
  });
});
