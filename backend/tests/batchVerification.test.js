jest.mock("../services/blockchainService", () => ({
  getBatchFromChain: jest.fn(),
  getLatestTemperatureReadingFromChain: jest.fn(),
  getBatchTemperatureHistoryFromChain: jest.fn(),
  verifyTemperatureReadingOnChain: jest.fn(),
  verifyTemperatureTransactionOnChain: jest.fn(),
}));
jest.mock("../models/TelemetryAnchor", () => ({ findOne: jest.fn() }));

const chain = require("../services/blockchainService");
const TelemetryAnchor = require("../models/TelemetryAnchor");
const { verifyBatch, getBatchVerificationPayload, getBatchOnChainTelemetry } = require("../controllers/batchController");
const address = "0x" + "1".repeat(40), recordId = "0x" + "2".repeat(64), digest = "0x" + "3".repeat(64), transactionHash = "0x" + "4".repeat(64);
function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  chain.getBatchFromChain.mockResolvedValue({ batchId: "DEMO-B", vaccineType: "Synthetic", quantity: 10, status: "Registered" });
  chain.getLatestTemperatureReadingFromChain.mockResolvedValue({ batchId: "DEMO-B", chainId: 31337, contractAddress: address,
    total: 1, latestReading: { recordId, digest, batchId: "DEMO-B", temperature: 5.25 } });
  chain.verifyTemperatureReadingOnChain.mockResolvedValue({ recordId, digest, batchId: "DEMO-B", temperature: 5.25 });
  chain.verifyTemperatureTransactionOnChain.mockResolvedValue(true);
  const query = { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ rawTxHash: transactionHash,
    rawChainId: 31337, rawContractAddress: address }) };
  TelemetryAnchor.findOne.mockReturnValue(query);
});

test("verification payload binds the latest raw sensor reading to its local contract", async () => {
  const res = response();
  await getBatchVerificationPayload({ params: { batchId: "DEMO-B" } }, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ batchId: "DEMO-B", chainId: 31337,
    contractAddress: address, telemetryCount: 1, latestReading: expect.objectContaining({ recordId, digest, transactionHash }) }));
});

test("role-scoped on-chain history endpoint returns paginated raw sensor data and validates page bounds", async () => {
  chain.getBatchTemperatureHistoryFromChain.mockResolvedValue({ batchId: "DEMO-B", chainId: 31337,
    offset: 10, limit: 20, total: 25, nextOffset: null, readings: [{ recordId, digest, temperature: 5.25 }] });
  const res = response();
  await getBatchOnChainTelemetry({ params: { batchId: "DEMO-B" }, query: { offset: "10", limit: "20" } }, res);
  expect(chain.getBatchTemperatureHistoryFromChain).toHaveBeenCalledWith("DEMO-B", { offset: 10, limit: 20 });
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 25, readings: [expect.objectContaining({ digest, temperature: 5.25 })] }));
  const invalid = response();
  await getBatchOnChainTelemetry({ params: { batchId: "DEMO-B" }, query: { offset: "-1", limit: "501" } }, invalid);
  expect(invalid.status).toHaveBeenCalledWith(400);
  expect(chain.getBatchTemperatureHistoryFromChain).toHaveBeenCalledTimes(1);
});

test("batch-only verification reports that no sensor record proof was checked", async () => {
  const res = response();
  await verifyBatch({ params: { batchId: "DEMO-B" }, query: {} }, res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ verified: true, telemetryVerified: false,
    telemetryCount: 1, latestReading: expect.objectContaining({ digest }) }));
  expect(chain.verifyTemperatureReadingOnChain).not.toHaveBeenCalled();
});

test("QR proof must match chain, contract, batch, record ID and digest", async () => {
  const res = response();
  await verifyBatch({ params: { batchId: "DEMO-B" }, query: { recordId, digest, transactionHash, chainId: "31337", contractAddress: address } }, res);
  expect(chain.verifyTemperatureTransactionOnChain).toHaveBeenCalledWith(transactionHash, "DEMO-B", recordId, digest);
  expect(chain.verifyTemperatureReadingOnChain).toHaveBeenCalledWith("DEMO-B", recordId, digest);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ verified: true, telemetryVerified: true,
    verifiedReading: expect.objectContaining({ recordId, digest }) }));
  const wrongContract = response();
  await verifyBatch({ params: { batchId: "DEMO-B" }, query: { recordId, digest, transactionHash, chainId: "31337", contractAddress: "0x" + "5".repeat(40) } }, wrongContract);
  expect(wrongContract.status).toHaveBeenCalledWith(409);
  expect(chain.verifyTemperatureReadingOnChain).toHaveBeenCalledTimes(1);
});

test("unknown or mismatched telemetry hashes never verify as a sensor proof", async () => {
  chain.verifyTemperatureReadingOnChain.mockResolvedValue(null);
  const res = response();
  await verifyBatch({ params: { batchId: "DEMO-B" }, query: { recordId, digest, transactionHash, chainId: "31337", contractAddress: address } }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({ error: "The QR sensor record or digest does not match the local blockchain" });
});

test("QR transaction must contain the matching append-only temperature event", async () => {
  chain.verifyTemperatureTransactionOnChain.mockResolvedValue(false);
  const res = response();
  await verifyBatch({ params: { batchId: "DEMO-B" }, query: { recordId, digest, transactionHash, chainId: "31337", contractAddress: address } }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({ error: "The QR transaction does not contain the matching local-chain temperature event" });
  expect(chain.verifyTemperatureReadingOnChain).not.toHaveBeenCalled();
});
