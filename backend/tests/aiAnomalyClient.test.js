jest.mock("axios", () => ({ post: jest.fn() }));

const axios = require("axios");
const { getTelemetryAnomaly } = require("../services/aiService");

beforeEach(() => jest.clearAllMocks());

test("GPS fixes and timestamp reach the advisory service even without policy context", async () => {
  axios.post.mockResolvedValue({ data: { status: "NORMAL", reason: "GPS within speed limit" } });
  await getTelemetryAnomaly({ temperature: 5, history: [], latitude: 9.93, longitude: 76.27,
    timestamp: "2026-01-01T00:00:00Z" });
  expect(axios.post.mock.calls[0][1]).toMatchObject({ latitude: 9.93, longitude: 76.27,
    current_timestamp: "2026-01-01T00:00:00Z" });
});

test("backend sends the prior same-stream readings to the local anomaly endpoint", async () => {
  const inference = { status: "ANOMALY", is_anomaly: true, advisory_only: true,
    reason: "Temperature was above the prior-window median.", metrics: {} };
  axios.post.mockResolvedValue({ data: inference });
  const history = Array.from({ length: 5 }, () => ({ temperature: 5, humidity: 55 }));
  await expect(getTelemetryAnomaly({ temperature: 10, humidity: 55, history, batchId: "B-1", deviceId: "D-1",
    correlationId: "trace.ai-7" })).resolves.toEqual(inference);
  expect(axios.post).toHaveBeenCalledWith(`${process.env.AI_BASE_URL || "http://127.0.0.1:8000"}/anomaly/detect`, {
    temperature: 10, humidity: 55, history, batch_id: "B-1", device_id: "D-1",
  }, expect.objectContaining({ timeout: expect.any(Number), headers: { "x-correlation-id": "trace.ai-7" } }));
});

test("AI service outage returns an explicit advisory-unavailable result instead of throwing", async () => {
  axios.post.mockRejectedValue(new Error("connection refused"));
  await expect(getTelemetryAnomaly({ temperature: 10, humidity: null, history: [] })).resolves.toMatchObject({
    status: "UNAVAILABLE", advisory_only: true, is_anomaly: false,
    reason: expect.stringContaining("policy rules remain authoritative"),
  });
});
