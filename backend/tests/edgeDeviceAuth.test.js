const { signDeviceTelemetry, verifyDeviceTelemetry } = require("../edge-gateway/deviceAuth");

test("device HMAC authenticates the device identity and exact telemetry fields", () => {
  const reading = { deviceId: "sensor-1", sequenceNumber: 4, temperature: 5.2, humidity: 58,
    batteryLevel: 92, latitude: 9.93, longitude: 76.26, timestamp: "2026-10-05T00:00:00.000Z" };
  const signature = signDeviceTelemetry("local-demo-secret", reading);
  expect(verifyDeviceTelemetry("local-demo-secret", reading, "sensor-1", signature)).toBe(true);
  expect(verifyDeviceTelemetry("local-demo-secret", { ...reading, temperature: 50 }, "sensor-1", signature)).toBe(false);
  expect(verifyDeviceTelemetry("local-demo-secret", reading, "other-device", signature)).toBe(false);
});
