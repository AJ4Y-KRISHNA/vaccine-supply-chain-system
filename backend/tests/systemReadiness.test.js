const { databaseHealth, blockchainHealth, aiServiceHealth } = require("../services/systemReadiness");

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

test("AI health makes a bounded synthetic advisory decision request", async () => {
  const post = jest.fn().mockResolvedValue({ status: 200, data: {
    advisory_only: true,
    decision: { forecast_demand: 8, recommended_units: 2, risk_flag: false },
  } });
  const result = await aiServiceHealth({ post });

  expect(result).toMatchObject({ service: "FastAPI AI service", status: "healthy", reachable: true, healthy: true });
  expect(result.latencyMs).toEqual(expect.any(Number));
  expect(post).toHaveBeenCalledWith(expect.stringMatching(/127\.0\.0\.1:8000\/decision\/decide$/), expect.objectContaining({
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
