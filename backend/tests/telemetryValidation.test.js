const { validateTelemetry } = require("../services/telemetryValidation");

const NOW = new Date("2026-10-05T12:00:00.000Z");
function reading(overrides = {}) {
  return { deviceId: "SYNTHETIC-DEVICE-1", sequenceNumber: 4, temperature: 5.2, humidity: 58, batteryLevel: 92,
    location: { lat: 9.9312, lng: 76.2673 }, recordedAt: NOW.toISOString(), ...overrides };
}

describe("bounded synthetic telemetry validation", () => {
  test("accepts the inclusive temperature, humidity, battery and GPS boundaries", () => {
    const { error, value } = validateTelemetry(reading({ temperature: -40, humidity: 0, batteryLevel: 100,
      location: { lat: -90, lng: 180 } }), { now: NOW });
    expect(error).toBeUndefined();
    expect(value[0]).toMatchObject({ temperature: -40, humidity: 0, batteryLevel: 100,
      location: { lat: -90, lng: 180 }, sequenceNumber: 4 });
    expect(validateTelemetry(reading({ temperature: 60, location: { lat: 90, lng: -180 } }), { now: NOW }).error).toBeUndefined();
  });

  test.each([
    ["temperature below range", { temperature: -40.01 }],
    ["temperature above range", { temperature: 60.01 }],
    ["humidity below range", { humidity: -0.01 }],
    ["humidity above range", { humidity: 100.01 }],
    ["battery below range", { batteryLevel: -0.01 }],
    ["battery above range", { batteryLevel: 100.01 }],
    ["latitude below range", { location: { lat: -90.01, lng: 0 } }],
    ["latitude above range", { location: { lat: 90.01, lng: 0 } }],
    ["longitude below range", { location: { lat: 0, lng: -180.01 } }],
    ["longitude above range", { location: { lat: 0, lng: 180.01 } }],
  ])("rejects %s", (_label, values) => {
    expect(validateTelemetry(reading(values), { now: NOW }).error).toBeDefined();
  });

  test("rejects timestamps outside the past 24-hour and future 5-minute window", () => {
    expect(validateTelemetry(reading({ recordedAt: new Date(+NOW - 24 * 60 * 60 * 1000).toISOString() }), { now: NOW }).error).toBeUndefined();
    expect(validateTelemetry(reading({ recordedAt: new Date(+NOW + 5 * 60 * 1000).toISOString() }), { now: NOW }).error).toBeUndefined();
    expect(validateTelemetry(reading({ recordedAt: new Date(+NOW - 24 * 60 * 60 * 1000 - 1).toISOString() }), { now: NOW }).error).toBeDefined();
    expect(validateTelemetry(reading({ recordedAt: new Date(+NOW + 5 * 60 * 1000 + 1).toISOString() }), { now: NOW }).error).toBeDefined();
    expect(validateTelemetry(reading({ recordedAt: "not-a-date" }), { now: NOW }).error).toBeDefined();
  });

  test("fills an omitted legacy timestamp with ingestion time", () => {
    const { error, value } = validateTelemetry(reading({ recordedAt: undefined }), { now: NOW });
    expect(error).toBeUndefined();
    expect(value[0].recordedAt.toISOString()).toBe(NOW.toISOString());
  });
});
