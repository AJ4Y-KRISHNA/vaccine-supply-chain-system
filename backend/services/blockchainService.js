const { ethers } = require("ethers");
const { isAllowedLocalHost } = require("./localNetwork");
let txQueue = Promise.resolve();
let provider;
function configuration(role = "writer") {
  const rpc = new URL(process.env.RPC_URL || "http://127.0.0.1:8545");
  if (rpc.protocol !== "http:" || !isAllowedLocalHost(rpc.hostname) || rpc.username || rpc.password) {
    throw new Error("This software prototype only supports a loopback local blockchain RPC");
  }
  if (!ethers.isAddress(process.env.CONTRACT_ADDRESS || "")) throw new Error("Configure the deployed local CONTRACT_ADDRESS");
  const abi = require("../../blockchain/artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json").abi;
  if (!provider) {
    const request = new ethers.FetchRequest(rpc.href);
    request.timeout = 3000;
    provider = new ethers.JsonRpcProvider(request, 31337, { staticNetwork: true });
  }
  const variable = { writer: "PRIVATE_KEY", production: "PRODUCTION_PRIVATE_KEY", lab: "LAB_PRIVATE_KEY" }[role];
  let key = process.env[variable];
  // Explicitly opted-in PUBLIC Hardhat accounts: never fund or use outside chain 31337.
  if (process.env.LOCAL_CHAIN_DEMO === "true") {
    key = ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined,
      "m/44'/60'/0'/0/" + { writer: 0, production: 1, lab: 2 }[role]).privateKey;
  }
  return { abi, address: process.env.CONTRACT_ADDRESS, key };
}
async function contractFor(role, write = false, address) {
  const config = configuration(role);
  if (BigInt(await provider.send("eth_chainId", [])) !== 31337n) throw new Error("Local chain ID 31337 required");
  if (await provider.getCode(address || config.address) === "0x") throw new Error("No contract deployed at configured address");
  if (write && !config.key) throw new Error("Configure a local " + role + " signing key");
  return new ethers.Contract(address || config.address, config.abi, write ? new ethers.Wallet(config.key, provider) : provider);
}
function write(method, args, role = "writer", address) {
  const next = txQueue.then(async () => {
    const contract = await contractFor(role, true, address);
    // Fresh pending nonce per signer. Never retry an uncertain send automatically.
    const nonce = Number(await provider.send("eth_getTransactionCount", [contract.runner.address, "pending"]));
    const transaction = await contract[method](...args, { nonce });
    const receipt = await transaction.wait();
    if (receipt?.status !== 1) throw new Error("Local transaction was not confirmed successfully");
    return receipt;
  });
  txQueue = next.catch(() => {});
  return next;
}
const whole = value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Chain quantity must be a nonnegative safe integer");
  return number;
};
const extractHash = receipt => {
  const value = receipt?.hash || receipt?.transactionHash || "";
  return /^0x[0-9a-f]{64}$/i.test(value) ? value : "";
};
const TELEMETRY_COMMITMENT_TYPE = "tuple(string batchId,bytes32 recordId,string deviceId,string vehicleId,string shipmentId,uint256 recordedAtMilliseconds,int256 temperatureMilliC,uint256 humidityMilliPercent,uint256 batteryMilliPercent,int256 latitudeMicrodegrees,int256 longitudeMicrodegrees,bool hasHumidity,bool hasBattery,bool hasLocation)";
const telemetryCoder = ethers.AbiCoder.defaultAbiCoder();
function scaledTelemetryValue(value, scale, name, { optional = false, min = -100000, max = 100000 } = {}) {
  if (value == null && optional) return 0n;
  if (value == null) throw new Error(`Missing ${name} for local-chain telemetry`);
  const number = Number(value);
  const scaled = Math.round(number * scale);
  if (!Number.isFinite(number) || !Number.isSafeInteger(scaled) || scaled < min || scaled > max) {
    throw new Error(`Invalid ${name} for local-chain telemetry`);
  }
  return BigInt(scaled);
}
function prepareTemperatureReading(data) {
  const batchId = String(data.batchId || "").trim();
  const recordId = String(data.recordId || data.eventId || "");
  if (!batchId || batchId.length > 120 || !/^0x[0-9a-f]{64}$/i.test(recordId) || /^0x0{64}$/i.test(recordId)) {
    throw new Error("A batch ID and nonzero bytes32 record ID are required for local-chain telemetry");
  }
  const location = data.location && typeof data.location === "object" ? data.location : {};
  const hasHumidity = Number.isFinite(Number(data.humidity)) && data.humidity != null;
  const hasBattery = Number.isFinite(Number(data.batteryLevel)) && data.batteryLevel != null;
  const latitude = location.lat ?? data.latitude, longitude = location.lng ?? data.longitude;
  const hasLocation = latitude != null && latitude !== "" && longitude != null && longitude !== ""
    && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
  const recordedAtMilliseconds = new Date(data.recordedAt ?? data.timestamp).getTime();
  if (!Number.isSafeInteger(recordedAtMilliseconds) || recordedAtMilliseconds <= 0) throw new Error("Invalid telemetry timestamp for local-chain telemetry");
  const values = [
    batchId, recordId, String(data.deviceId || data.sensorId || "").slice(0, 128),
    String(data.vehicleId || "").slice(0, 128), String(data.shipmentId || "").slice(0, 128), BigInt(recordedAtMilliseconds),
    scaledTelemetryValue(data.temperature, 1000, "temperature", { min: -100000, max: 100000 }),
    scaledTelemetryValue(data.humidity, 1000, "humidity", { optional: true, min: 0, max: 100000 }),
    scaledTelemetryValue(data.batteryLevel, 1000, "battery", { optional: true, min: 0, max: 100000 }),
    hasLocation ? scaledTelemetryValue(latitude, 1000000, "latitude", { min: -90000000, max: 90000000 }) : 0n,
    hasLocation ? scaledTelemetryValue(longitude, 1000000, "longitude", { min: -180000000, max: 180000000 }) : 0n,
    hasHumidity, hasBattery, hasLocation,
  ];
  const digest = ethers.sha256(telemetryCoder.encode([TELEMETRY_COMMITMENT_TYPE], [values]));
  const chainRecord = [values[1], digest, values[0], ...values.slice(2)];
  return { batchId, recordId, digest, values, chainRecord };
}
function serializeTemperatureReading(row) {
  const asNumber = (value, scale) => Number(value) / scale;
  return {
    recordId: row.recordId, digest: row.digest, batchId: row.batchId, deviceId: row.deviceId,
    vehicleId: row.vehicleId, shipmentId: row.shipmentId, recordedAt: new Date(Number(row.recordedAtMilliseconds)).toISOString(),
    temperature: asNumber(row.temperatureMilliC, 1000), humidity: row.hasHumidity ? asNumber(row.humidityMilliPercent, 1000) : null,
    batteryLevel: row.hasBattery ? asNumber(row.batteryMilliPercent, 1000) : null,
    location: row.hasLocation ? { lat: asNumber(row.latitudeMicrodegrees, 1000000), lng: asNumber(row.longitudeMicrodegrees, 1000000) } : null,
  };
}
async function recordTemperatureReadingOnChain(data) {
  const prepared = prepareTemperatureReading(data);
  const receipt = await write("recordTemperatureReading", [prepared.chainRecord]);
  const row = await (await contractFor("writer")).getTemperatureReadingById(prepared.recordId);
  if (row.digest !== prepared.digest || row.batchId !== prepared.batchId) throw new Error("On-chain telemetry verification failed");
  return { ...serializeTemperatureReading(row), txHash: extractHash(receipt), chainId: 31337, verified: true };
}
async function getBatchTemperatureHistoryFromChain(batchId, { offset = 0, limit = 100 } = {}) {
  const contract = await contractFor("writer"), count = Number(await contract.getTemperatureReadingCount(batchId));
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  const start = Math.max(0, Math.min(count, Math.floor(Number(offset) || 0))), end = Math.min(count, start + safeLimit), readings = [];
  for (let index = start; index < end; index++) readings.push(serializeTemperatureReading(await contract.getTemperatureReading(batchId, index)));
  const config = configuration("writer"), network = await provider.getNetwork();
  return { batchId, chainId: Number(network.chainId), contractAddress: config.address, total: count,
    offset: start, limit: safeLimit, nextOffset: end < count ? end : null, readings };
}
async function getLatestTemperatureReadingFromChain(batchId) {
  const contract = await contractFor("writer"), count = Number(await contract.getTemperatureReadingCount(batchId));
  if (!count) return { batchId, chainId: 31337, contractAddress: configuration("writer").address, total: 0, latestReading: null };
  const row = await contract.getTemperatureReading(batchId, count - 1), network = await provider.getNetwork();
  return { batchId, chainId: Number(network.chainId), contractAddress: configuration("writer").address,
    total: count, latestReading: serializeTemperatureReading(row) };
}
async function verifyTemperatureReadingOnChain(batchId, recordId, digest) {
  if (!/^0x[0-9a-f]{64}$/i.test(String(recordId || "")) || !/^0x[0-9a-f]{64}$/i.test(String(digest || ""))) return null;
  try {
    const row = await (await contractFor("writer")).getTemperatureReadingById(recordId);
    if (row.batchId !== batchId || row.digest.toLowerCase() !== digest.toLowerCase()) return null;
    return serializeTemperatureReading(row);
  } catch (_) { return null; }
}

function matchesTemperatureReadingEvent(parsed, batchId, recordId, digest) {
  if (parsed?.name !== "TemperatureReadingAppended") return false;
  const indexedBatch = parsed.args.batchId;
  // Solidity hashes indexed dynamic values (including string) into a topic.
  // Ethers therefore exposes an Indexed value rather than the original string.
  const batchMatches = typeof indexedBatch === "string"
    ? indexedBatch === batchId
    : indexedBatch?.hash?.toLowerCase() === ethers.id(batchId).toLowerCase();
  return batchMatches && parsed.args.recordId.toLowerCase() === recordId.toLowerCase() &&
    parsed.args.digest.toLowerCase() === digest.toLowerCase();
}

async function verifyTemperatureTransactionOnChain(transactionHash, batchId, recordId, digest) {
  if (!/^0x[0-9a-f]{64}$/i.test(String(transactionHash || "")) ||
      !/^0x[0-9a-f]{64}$/i.test(String(recordId || "")) ||
      !/^0x[0-9a-f]{64}$/i.test(String(digest || ""))) return false;
  try {
    const contract = await contractFor("writer");
    const address = (await contract.getAddress()).toLowerCase();
    const receipt = await provider.getTransactionReceipt(transactionHash);
    if (!receipt || receipt.status !== 1 || receipt.to?.toLowerCase() !== address) return false;
    return receipt.logs.some(log => {
      if (log.address?.toLowerCase() !== address) return false;
      try {
        const parsed = contract.interface.parseLog(log);
        return matchesTemperatureReadingEvent(parsed, batchId, recordId, digest);
      } catch (_) { return false; }
    });
  } catch (_) { return false; }
}
const recordOnBlockchain = data => write("recordDistribution", [String(data.targetCenter || "Unknown Center"), whole(data.recommended_units || 0), String(data.priority_score || data.status || data.risk_flag || "Stable")]);
const registerBatchOnChain = (id, type, quantity) => write("registerBatch", [id, type, whole(quantity)]);
const mintInventoryCertificateOnChain = (id, type, demand, uri) => write("mintInventoryCertificate", [id, type, whole(demand), uri || ""]);
const approveBatchReleaseOnChain = (id, role) => {
  if (!["Production", "Lab Testing"].includes(role)) throw new Error("Invalid release role");
  return write("approveBatchRelease", [id, role], role === "Production" ? "production" : "lab");
};
const updateBatchStatusOnChain = (id, status) => write("updateBatchStatus", [id, status]);
const merkleAddress = () => process.env.MERKLE_CONTRACT_ADDRESS || process.env.CONTRACT_ADDRESS;
async function logLifecycleEventOnChain({ batchId, actorRole, action, location = "", details = "", quantity = 0,
  shipmentId = "", vehicleId = "", routeId = "" }) {
  const args = [String(batchId), String(actorRole), String(action), String(location), String(details), whole(quantity)];
  if (process.env.TELEMETRY_ANCHOR_MODE === "legacy") return write("logLifecycleEvent", args);
  // Preserve original contract history when using a separately deployed companion.
  if (process.env.TELEMETRY_ANCHOR_MODE !== "legacy" && merkleAddress()?.toLowerCase() !== process.env.CONTRACT_ADDRESS?.toLowerCase()) {
    const receipt = await write("logLifecycleEvent", args);
    await write("logTransportLifecycle", [[...args, 0, ethers.ZeroAddress], [String(shipmentId), String(vehicleId), String(routeId)]], "writer", merkleAddress());
    return receipt;
  }
  return write("logTransportLifecycle", [[...args, 0, ethers.ZeroAddress], [String(shipmentId), String(vehicleId), String(routeId)]]);
}
async function getSensorRoot(windowId, address = merkleAddress()) {
  const row = await (await contractFor("writer", false, address)).getSensorRoot(windowId);
  return { root: row.root, batchId: row.batchId, windowStart: Number(row.windowStart), windowEnd: Number(row.windowEnd), count: Number(row.count),
    contractAddress: address, chainId: 31337 };
}
async function merkleContractStatus() {
  try {
    const contract = await contractFor("writer", true, merkleAddress());
    await contract.getSensorRoot(ethers.ZeroHash);
    return { healthy: Boolean(await contract.writers(contract.runner.address)), chainId: 31337, contractAddress: merkleAddress() };
  } catch (_) { return { healthy: false, chainId: 31337, contractAddress: merkleAddress(), error: "Merkle contract or authorized writer unavailable; upgrade without resetting the batch contract" }; }
}
async function anchorSensorRoot(window) {
  const address = merkleAddress();
  const prior = await getSensorRoot(window.windowId, address);
  const args = [window.windowId, window.batchId, window.root, new Date(window.windowStart).getTime(), new Date(window.windowEnd).getTime(), window.count];
  let receipt;
  if (!prior.count) receipt = await write("anchorSensorRoot", args, "writer", address);
  const stored = await getSensorRoot(window.windowId, address);
  if (stored.root !== window.root || stored.batchId !== window.batchId || stored.count !== window.count
    || stored.windowStart !== args[3] || stored.windowEnd !== args[4]) throw new Error("Merkle window conflict");
  // Recover an already-mined receipt after a crash without charging a second tx.
  if (!receipt) {
    const contract = await contractFor("writer", false, address);
    const events = await contract.queryFilter(contract.filters.SensorRootAnchored(window.windowId));
    if (events.length) receipt = await provider.getTransactionReceipt(events[0].transactionHash);
  }
  return { ...stored, txHash: extractHash(receipt), gasUsed: receipt?.gasUsed?.toString() || null,
    gasPerReading: receipt ? Number(receipt.gasUsed) / window.count : null };
}
async function getBatchFromChain(id) {
  const row = await (await contractFor("writer")).getBatch(id);
  if (!row[0]) return null;
  return { batchId: row[0], vaccineType: row[1], quantity: Number(row[2]), manufacturer: row[3], status: row[4] };
}
async function assertBatchCreationReady(id) {
  try {
    const contract = await contractFor("writer", true);
    if (!await contract.writers(contract.runner.address)) throw new Error("Writer is not authorized");
    const existing = await contract.getBatch(id);
    if (existing[0]) throw Object.assign(new Error("Batch ID already exists on the local blockchain. Use a new ID for a new batch."),
      { status: 409, code: "CHAIN_BATCH_EXISTS" });
  } catch (error) {
    if (error.code === "CHAIN_BATCH_EXISTS") throw error;
    throw Object.assign(new Error("Local blockchain is not ready. Start the node and check the deployed contract address and writer configuration before creating a batch."),
      { status: 503, code: "BLOCKCHAIN_NOT_READY" });
  }
}
async function getBatchLifecycleFromChain(id) {
  const contract = await contractFor("writer"), count = Number(await contract.getLifecycleCount(id));
  const lifecycle = [];
  for (let index = 0; index < count; index++) {
    const row = await contract.getLifecycleEvent(id, index);
    let transport = { shipmentId: "", vehicleId: "", routeId: "", transportRecorded: false };
    try { const data = await contract.getLifecycleTransport(id, index); transport = { shipmentId: data.shipmentId, vehicleId: data.vehicleId, routeId: data.routeId, transportRecorded: true }; } catch (_) { /* Original immutable contract has no transport getter. */ }
    lifecycle.push({ batchId: row[0], actorRole: row[1], action: row[2], location: row[3], details: row[4], quantity: Number(row[5]), timestamp: Number(row[6]), actor: row[7], ...transport });
  }
  const transportLifecycle = [];
  if (process.env.TELEMETRY_ANCHOR_MODE !== "legacy" && merkleAddress()?.toLowerCase() !== process.env.CONTRACT_ADDRESS?.toLowerCase()) {
    const companion = await contractFor("writer", false, merkleAddress());
    const total = Number(await companion.getLifecycleCount(id));
    for (let index = 0; index < total; index++) {
      const row = await companion.getLifecycleEvent(id, index), metadata = await companion.getLifecycleTransport(id, index);
      transportLifecycle.push({ batchId: row[0], actorRole: row[1], action: row[2], location: row[3], details: row[4], quantity: Number(row[5]), timestamp: Number(row[6]),
        actor: row[7], shipmentId: metadata.shipmentId, vehicleId: metadata.vehicleId, routeId: metadata.routeId });
    }
  }
  return { batchId: id, batch: await getBatchFromChain(id), lifecycleCount: count, lifecycle, transportLifecycle };
}
async function getInventoryCertificateFromChain(id) {
  const row = await (await contractFor("writer")).getInventoryCertificate(id);
  return { batchId: row[0], vaccineType: row[1], predictedDemand: Number(row[2]), certificateUri: row[3], issuedAt: Number(row[4]), issuer: row[5] };
}
async function getBatchReleaseStateFromChain(id) {
  const row = await (await contractFor("writer")).getReleaseState(id);
  return { productionApproved: row[0], labApproved: row[1], releaseVisible: row[2], status: row[3] };
}
async function anchorAuditOnChain(eventId, digest) {
  const contract = await contractFor("writer");
  let stored = await contract.auditDigests(eventId);
  if (stored !== ethers.ZeroHash && stored !== digest) throw new Error("On-chain audit digest conflict");
  let receipt;
  if (stored === ethers.ZeroHash) receipt = await write("anchorAudit", [eventId, digest]);
  stored = await contract.auditDigests(eventId);
  if (stored !== digest) throw new Error("Audit anchor verification failed");
  return { digest: stored, txHash: extractHash(receipt), chainId: 31337, contractAddress: await contract.getAddress(), verified: true };
}
async function verifyAuditOnChain(eventId, digest) {
  return (await (await contractFor("writer")).auditDigests(eventId)) === digest;
}
function auditAnchorWriterConfigured() {
  try { return Boolean(configuration("writer").key); }
  catch (_) { return false; }
}
async function auditAnchorWriterStatus() {
  const configured = auditAnchorWriterConfigured();
  if (!configured) return { configured: false, authorized: false };
  try {
    const contract = await contractFor("writer", true);
    return { configured: true, authorized: Boolean(await contract.writers(contract.runner.address)) };
  } catch (_) {
    return { configured: true, authorized: false };
  }
}
module.exports = { recordOnBlockchain, registerBatchOnChain, mintInventoryCertificateOnChain, approveBatchReleaseOnChain,
  logLifecycleEventOnChain, updateBatchStatusOnChain, getBatchFromChain, getBatchLifecycleFromChain,
  getInventoryCertificateFromChain, getBatchReleaseStateFromChain, extractHash, anchorAuditOnChain, verifyAuditOnChain,
  auditAnchorWriterConfigured, auditAnchorWriterStatus, assertBatchCreationReady, prepareTemperatureReading,
  recordTemperatureReadingOnChain, getBatchTemperatureHistoryFromChain, getLatestTemperatureReadingFromChain,
  verifyTemperatureReadingOnChain, verifyTemperatureTransactionOnChain, matchesTemperatureReadingEvent,
  anchorSensorRoot, getSensorRoot, merkleAddress, merkleContractStatus };
