const { evaluateEdgeReading } = require("../edge-gateway/edgeMath");

describe("edge telemetry math", () => {
  test("calculates EWMA, rolling z-score and rate of change with a reasoned local threshold alert", () => {
    const previous = { ewma: 4, temperature: 5, timestamp: 1000, temperatures: [4, 5, 6, 5] };
    const result = evaluateEdgeReading({ temperature: 10, timestamp: 2000 }, previous);
    expect(result.edge.ewma).toBeCloseTo(4 + (1 - 0.7 ** (1 / 60)) * 6);
    expect(result.edge.rollingZScore).toBeGreaterThan(2);
    expect(result.edge.rateOfChange).toBe(5);
    expect(result.edge.localAlert).toMatchObject({ active: true, code: "TEMPERATURE_ABOVE_LOCAL_LIMIT" });
    expect(result.edge.localAlert.reason).toContain("outside the local 2–8°C threshold");
  });

  test("uses physical GPS speed immediately and documents the deployed/comparator difference", () => {
    const state = new (require("../models/EdgeGatewayState"))({ deviceId: "GPS-SYNTHETIC",
      ...evaluateEdgeReading({ temperature: 5, recordedAt: 1000, location: { lat: 10, lng: 76 } }).state }).toObject();
    expect(state.points).toHaveLength(1);
    expect(state.latitude).toBe(10); // Mongoose must not strip durable timing/GPS state.
    const edge = evaluateEdgeReading({ temperature: 5, recordedAt: 61000, location: { lat: 11, lng: 76 } }, state).edge;
    expect(edge.gpsPlausibility.flagged).toBe(true);
    expect(edge.gpsPlausibility.impliedSpeedKmh).toBeGreaterThan(6000);
    expect(edge.gpsPlausibility.reason).toContain("km/h");
    expect(edge.localAlert.active).toBe(false); // GPS advisory never overrides approved temperature policy.
    expect(edge.ruleProfile).toContain("evaluation-only");
    const { validateTelemetry } = require("../services/telemetryValidation");
    expect(validateTelemetry({ temperature: 5, edge }).error).toBeUndefined();
  });

  test("EWMA decay depends on elapsed seconds, and timed windows expire", () => {
    const prior = { temperature: 5, ewma: 5, timestamp: 0, points: [{ temperature: 5, timestamp: 0 }] };
    expect(evaluateEdgeReading({ temperature: 10, timestamp: 60000 }, prior).edge.ewma).toBe(6.5);
    expect(evaluateEdgeReading({ temperature: 10, timestamp: 10000 }, prior).edge.ewma).toBeLessThan(6);
    expect(evaluateEdgeReading({ temperature: 10, timestamp: 1900000 }, prior).state.points).toHaveLength(1);
    expect(evaluateEdgeReading({ temperature: 5, timestamp: 0, latitude: 11, longitude: 76 }, prior).edge.gpsPlausibility.flagged).toBe(false);
  });

  test("normal-range temperatures remain non-alerting and input errors are rejected", () => {
    expect(evaluateEdgeReading({ temperature: 5, timestamp: 1000 }).edge.localAlert.active).toBe(false);
    expect(() => evaluateEdgeReading({ temperature: NaN })).toThrow("temperature must be finite");
  });
});
