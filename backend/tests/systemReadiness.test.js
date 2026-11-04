const net = require("node:net");
const { EventEmitter } = require("node:events");
const { databaseHealth, blockchainHealth, aiServiceHealth, coldChainAnchoringHealth, mqttHealth, redisHealth, emailHealth, pingRedis, workerHealth,
  EMAIL_HEALTH_TIMEOUT_MS, EMAIL_HEALTH_CACHE_MS, resetEmailHealthCache } = require("../services/systemReadiness");

function databaseConnection({ insertOne, findOne, deleteOne } = {}) {
  const collection = {
    insertOne: insertOne || jest.fn(async () => ({ acknowledged: true })),
    findOne: findOne || jest.fn(async query => ({ _id: query._id, probeValue: "probe" })),
    deleteOne: deleteOne || jest.fn(async () => ({ deletedCount: 1 })),
  };
  return {
    connection: { readyState: 1, db: { collection: jest.fn(() => collection) } },
    collection,
  };
}

function blockchainProvider(overrides = {}) {
  return {
    getNetwork: jest.fn().mockResolvedValue({ chainId: 31337n }),
    getBlockNumber: jest.fn().mockResolvedValueOnce(14).mockResolvedValueOnce(15),
    send: jest.fn().mockResolvedValue("0x"),
    getCode: jest.fn().mockResolvedValue("0x6000"),
    destroy: jest.fn(),
    ...overrides,
  };
}

test("MongoDB health requires and cleans up a successful write/read round trip", async () => {
  let stored;
  const { connection, collection } = databaseConnection({
    insertOne: jest.fn(async document => { stored = document; return { acknowledged: true }; }),
    findOne: jest.fn(async query => stored?._id === query._id ? stored : null),
    deleteOne: jest.fn(async query => { if (stored?._id === query._id) stored = null; return { deletedCount: 1 }; }),
  });

  const result = await databaseHealth({ connection });

  expect(result).toMatchObject({ service: "MongoDB", status: "healthy", reachable: true, healthy: true, check: "write-read-delete round trip" });
  expect(result.latencyMs).toEqual(expect.any(Number));
  expect(collection.insertOne).toHaveBeenCalledTimes(1);
  expect(collection.findOne).toHaveBeenCalledTimes(1);
  expect(collection.deleteOne).toHaveBeenCalledTimes(1);
  expect(stored).toBeNull();
});

test("external worker readiness requires a fresh Redis heartbeat", async () => {
  const freshClient = { on: jest.fn(), connect: jest.fn().mockResolvedValue(), get: jest.fn().mockResolvedValue("100000"),
    quit: jest.fn().mockResolvedValue() };
  const fresh = await workerHealth({ mode: "external", host: "127.0.0.1", createRedisClient: () => freshClient, now: 105000 });
  expect(fresh).toMatchObject({ service: "Redis Stream worker", status: "healthy", reachable: true, healthy: true, heartbeatAgeMs: 5000 });
  const staleClient = { ...freshClient, get: jest.fn().mockResolvedValue(null), quit: jest.fn().mockResolvedValue() };
  const stale = await workerHealth({ mode: "external", host: "127.0.0.1", createRedisClient: () => staleClient, now: 105000 });
  expect(stale).toMatchObject({ status: "stale-or-missing", reachable: true, healthy: false, failure: "heartbeat-missing" });
});

test("MongoDB health reports disconnected and failed probe paths", async () => {
  const disconnected = await databaseHealth({ connection: { readyState: 0, db: null } });
  expect(disconnected).toMatchObject({ status: "unavailable", reachable: false, healthy: false, failure: "not-connected" });

  const { connection, collection } = databaseConnection({
    findOne: jest.fn().mockRejectedValue(new Error("database read failed")),
  });
  const failedRead = await databaseHealth({ connection });
  expect(failedRead).toMatchObject({ status: "unhealthy", reachable: true, healthy: false, failure: "read-write-probe-failed" });
  expect(collection.deleteOne).toHaveBeenCalledTimes(1);
});

test("local blockchain health confirms block advancement and reports timing/contract state", async () => {
  const provider = blockchainProvider();
  const result = await blockchainHealth({
    providerFactory: jest.fn(() => provider),
    artifactExists: () => true,
    contractAddress: "0x1111111111111111111111111111111111111111",
  });

  expect(result).toMatchObject({ status: "healthy", reachable: true, healthy: true, blockNumberBefore: 14, blockNumber: 15, blockProgressed: true });
  expect(result.contract).toMatchObject({ addressConfigured: true, artifactAvailable: true, deployed: true, healthy: true, status: "ready" });
  expect(provider.send).toHaveBeenCalledWith("evm_mine", []);
  expect(provider.destroy).toHaveBeenCalledTimes(1);
  expect(result.latencyMs).toEqual(expect.any(Number));
});

test("blockchain RPC can be reachable while block production fails", async () => {
  const provider = blockchainProvider({ send: jest.fn().mockRejectedValue(new Error("mine unavailable")) });
  const result = await blockchainHealth({ providerFactory: () => provider, artifactExists: () => false });

  expect(result).toMatchObject({ status: "unhealthy", reachable: true, healthy: false, blockProgressed: false, failure: "rpc-check-failed" });
});

test.each([
  ["no configured contract", { contractAddress: "" }, { status: "contract-not-ready", healthy: false, failure: "contract-address-required" }],
  ["missing artifact", { artifactExists: () => false }, { status: "contract-not-ready", healthy: false, contract: { healthy: false, status: "abi-artifact-missing" } }],
  ["missing deployed bytecode", { providerFactory: () => blockchainProvider({ getCode: jest.fn().mockResolvedValue("0x") }) },
    { status: "contract-not-ready", healthy: false, contract: { healthy: false, bytecodePresent: false, status: "no-contract-at-configured-address" } }],
])("blockchain readiness is not green with %s", async (_label, overrides, expected) => {
  const result = await blockchainHealth({ artifactExists: () => true,
    contractAddress: "0x1111111111111111111111111111111111111111", ...overrides });
  expect(result).toMatchObject(expected);
});

test("AI health makes a bounded synthetic advisory decision request", async () => {
  const post = jest.fn().mockResolvedValue({ status: 200, data: {
    advisory_only: true,
    decision: { forecast_demand: 8, recommended_units: 2, risk_flag: false },
  } });
  const result = await aiServiceHealth({ post });

  expect(result).toMatchObject({ service: "FastAPI AI service", status: "healthy", reachable: true, healthy: true });
  expect(result.latencyMs).toEqual(expect.any(Number));
  expect(post).toHaveBeenCalledWith(`${process.env.AI_BASE_URL || "http://127.0.0.1:8000"}/decision/decide`, expect.objectContaining({
    social_text: expect.stringMatching(/Synthetic/),
    vaccination_history: [1, 2, 3, 4, 5, 6],
    target_center: "READINESS-CHECK",
  }), expect.objectContaining({ timeout: 2500 }));
});

test("AI health distinguishes an HTTP error, timeout, and a blocked remote endpoint", async () => {
  const serverError = await aiServiceHealth({ post: jest.fn().mockRejectedValue(Object.assign(new Error("failed"), { response: { status: 503 } })) });
  expect(serverError).toMatchObject({ status: "unhealthy", reachable: true, healthy: false, failure: "ai-service-error-response" });

  const timeout = await aiServiceHealth({ post: () => new Promise(() => {}), timeoutMs: 5 });
  expect(timeout).toMatchObject({ status: "timeout", reachable: false, healthy: false, failure: "check-timeout" });

  const post = jest.fn();
  const blocked = await aiServiceHealth({ baseUrl: "https://example.invalid", post });
  expect(blocked).toMatchObject({ status: "blocked-non-local-endpoint", reachable: false, healthy: false });
  expect(post).not.toHaveBeenCalled();
});

test("AI health permits only explicitly configured Docker service names for internal HTTP", async () => {
  const previous = process.env.DOCKER_INTERNAL_HOSTS;
  process.env.DOCKER_INTERNAL_HOSTS = "ai-service,mosquitto,redis,hardhat";
  try {
    const post = jest.fn().mockResolvedValue({ status: 200, data: { advisory_only: true,
      decision: { forecast_demand: 8, recommended_units: 2, risk_flag: false } } });
    const result = await aiServiceHealth({ baseUrl: "http://ai-service:8000", post });
    expect(result).toMatchObject({ status: "healthy", reachable: true, healthy: true });
    expect(post).toHaveBeenCalledWith(expect.stringMatching(/ai-service:8000\/decision\/decide$/), expect.any(Object), expect.any(Object));
  } finally { if (previous === undefined) delete process.env.DOCKER_INTERNAL_HOSTS; else process.env.DOCKER_INTERNAL_HOSTS = previous; }
});

test("MQTT readiness authenticates and accepts only loopback or explicitly allowlisted local services", async () => {
  const previous = process.env.DOCKER_INTERNAL_HOSTS;
  process.env.DOCKER_INTERNAL_HOSTS = "mosquitto";
  try {
    const client = new EventEmitter(); client.end = jest.fn();
    const connect = jest.fn(() => { queueMicrotask(() => client.emit("connect")); return client; });
    const result = await mqttHealth({ url: "mqtt://mosquitto:1883", username: "synthetic", password: "test-secret", connect });
    expect(result).toMatchObject({ service: "Mosquitto MQTT", status: "healthy", reachable: true, healthy: true, transport: "mqtt" });
    expect(connect).toHaveBeenCalledWith("mqtt://mosquitto:1883", expect.objectContaining({ username: "synthetic", password: "test-secret" }));
    expect(client.end).toHaveBeenCalledWith(true);
    const blocked = await mqttHealth({ url: "mqtt://unlisted-host:1883", connect });
    expect(blocked).toMatchObject({ status: "blocked-non-local-endpoint", healthy: false });
  } finally { if (previous === undefined) delete process.env.DOCKER_INTERNAL_HOSTS; else process.env.DOCKER_INTERNAL_HOSTS = previous; }
});

test("Redis readiness checks authenticated PING/PONG without returning the password", async () => {
  const previous = process.env.DOCKER_INTERNAL_HOSTS;
  process.env.DOCKER_INTERNAL_HOSTS = "redis";
  try {
    const probe = jest.fn().mockResolvedValue(true);
    const result = await redisHealth({ host: "redis", port: 6379, password: "not-returned-secret", probe });
    expect(result).toMatchObject({ service: "Redis", status: "healthy", reachable: true, healthy: true });
    expect(JSON.stringify(result)).not.toContain("not-returned-secret");
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ host: "redis", port: 6379, password: "not-returned-secret" }));
  } finally { if (previous === undefined) delete process.env.DOCKER_INTERNAL_HOSTS; else process.env.DOCKER_INTERNAL_HOSTS = previous; }
});

test("Redis PING probe speaks RESP and validates AUTH plus PONG responses", async () => {
  let received = "";
  const server = net.createServer(socket => socket.on("data", data => {
    received += data.toString("utf8");
    if (received.includes("PING")) socket.write("+OK\r\n+PONG\r\n");
  }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await expect(pingRedis({ host: "127.0.0.1", port: server.address().port, password: "test-pass" })).resolves.toBe(true);
    expect(received).toContain("AUTH"); expect(received).toContain("test-pass"); expect(received).toContain("PING");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("email health reflects the Ethereal capture transport result without provider credentials", async () => {
  const result = await emailHealth({ check: jest.fn().mockResolvedValue({ status: "healthy", healthy: true,
    reachable: true, mode: "ethereal", simulated: true, previewAvailable: true }) });
  expect(result).toMatchObject({ status: "healthy", reachable: true, healthy: true, mode: "ethereal", simulated: true, previewAvailable: true });
});

test("Ethereal readiness uses a 10-second probe, caches for 60 seconds, and degrades when recent capture succeeds", async () => {
  expect(EMAIL_HEALTH_TIMEOUT_MS).toBe(10_000);
  expect(EMAIL_HEALTH_CACHE_MS).toBe(60_000);
  const check = jest.fn().mockResolvedValue({ status: "healthy", healthy: true, reachable: true,
    mode: "ethereal", simulated: true, previewAvailable: true });
  resetEmailHealthCache();
  let now = 10_000;
  const first = await emailHealth({ check, cache: true, now: () => now });
  const cached = await emailHealth({ check, cache: true, now: () => now + 59_999 });
  expect(first.status).toBe("healthy");
  expect(cached).toMatchObject({ status: "healthy", cached: true, cacheAgeMs: 59_999 });
  expect(check).toHaveBeenCalledTimes(1);

  const degraded = await emailHealth({ check: () => new Promise(() => {}), timeoutMs: 2,
    hasRecentCapture: () => true, cache: false });
  expect(degraded).toMatchObject({ status: "degraded", reachable: true, healthy: false,
    mode: "ethereal", simulated: true, previewAvailable: true,
    failure: "smtp-probe-timeout-capture-confirmed" });
});

test("cold-chain anchoring readiness reports its flag, safe counts and local write prerequisites", async () => {
  const docs = { Audit: 4, AuditAnchor: { confirmed: 2, failed: 1 }, TemperatureLog: 5, TelemetryAnchor: { confirmed: 3, failed: 0 } };
  const model = value => ({ countDocuments: jest.fn(async filter => typeof value === "number" ? value : value[filter.status] || 0) });
  const result = await coldChainAnchoringHealth({ enabled: true, databaseHealthy: true, blockchain: { healthy: true, contract: { healthy: true } },
    writerConfigured: true, writerAuthorized: true, models: { Audit: model(docs.Audit), AuditAnchor: model(docs.AuditAnchor), TemperatureLog: model(docs.TemperatureLog), TelemetryAnchor: model(docs.TelemetryAnchor) } });
  expect(result).toMatchObject({ enabled: true, ready: true, status: "ready", writerConfigured: true, writerAuthorized: true,
    evidence: { coldChainAuditDigests: true, temperatureReadingDigests: true, rawTelemetryOnChain: true },
    counts: { coldChainAudit: { total: 4, confirmed: 2, failed: 1, pending: 1 }, temperatureHistory: { total: 5, confirmed: 3, failed: 0, pending: 2,
      rawOnChainConfirmed: 0, rawOnChainFailed: 0, rawOnChainPending: 5 } } });
  const disabled = await coldChainAnchoringHealth({ enabled: false, databaseHealthy: false, writerConfigured: false });
  expect(disabled).toMatchObject({ enabled: false, ready: false, status: "disabled", counts: null });
  const unauthorized = await coldChainAnchoringHealth({ enabled: true, databaseHealthy: true, blockchain: { healthy: true, contract: { healthy: true } },
    writerConfigured: true, writerAuthorized: false, models: { Audit: model(0), AuditAnchor: model({ confirmed: 0, failed: 0 }),
      TemperatureLog: model(0), TelemetryAnchor: model({ confirmed: 0, failed: 0 }) } });
  expect(unauthorized).toMatchObject({ ready: false, status: "writer-not-authorized", writerConfigured: true, writerAuthorized: false });
});
