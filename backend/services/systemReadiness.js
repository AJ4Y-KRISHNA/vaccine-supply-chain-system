const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const mongoose = require("mongoose");
const { ethers } = require("ethers");

const DEFAULT_TIMEOUT_MS = 2500;
const AI_DECISION_TIMEOUT_MS = 2500;
const localHost = host => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(String(host || "").toLowerCase());

async function within(promise, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function elapsedSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

async function databaseHealth({ connection = mongoose.connection, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const result = {
    service: "MongoDB",
    check: "write-read-delete round trip",
    status: "unavailable",
    reachable: connection.readyState === 1,
    healthy: false,
    latencyMs: null,
    failure: null,
  };
  if (!result.reachable || !connection.db) {
    result.failure = "not-connected";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }

  const probeId = randomUUID();
  const probeValue = randomUUID();
  let failure = null;
  let passed = false;
  let insertAttempted = false;
  let collection;
  try {
    collection = connection.db.collection("system_readiness_probes");
    insertAttempted = true;
    await within(collection.insertOne({ _id: probeId, probeValue, createdAt: new Date() }), timeoutMs);
    const stored = await within(collection.findOne({ _id: probeId }, { maxTimeMS: timeoutMs }), timeoutMs);
    passed = stored?.probeValue === probeValue;
    if (!passed) failure = "read-back-mismatch";
  } catch (_) {
    failure = "read-write-probe-failed";
  } finally {
    if (collection && insertAttempted) {
      try {
        await within(collection.deleteOne({ _id: probeId }), timeoutMs);
      } catch (_) {
        passed = false;
        failure = "probe-cleanup-failed";
      }
    }
  }

  result.healthy = passed;
  result.status = passed ? "healthy" : "unhealthy";
  result.failure = failure;
  result.latencyMs = elapsedSince(startedAt);
  return result;
}

async function blockchainHealth({
  rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545",
  contractAddress = process.env.CONTRACT_ADDRESS || "",
  artifactPath = path.join(__dirname, "../../blockchain/artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json"),
  artifactExists = fs.existsSync,
  providerFactory = url => new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true, polling: false, cacheTimeout: -1 }),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  const addressConfigured = ethers.isAddress(contractAddress);
  const artifactAvailable = artifactExists(artifactPath);
  const result = {
    service: "local blockchain",
    check: "local block production and contract lookup",
    status: "unavailable",
    reachable: false,
    healthy: false,
    latencyMs: null,
    blockProgressed: false,
    contract: { addressConfigured, artifactAvailable, deployed: false, healthy: false, status: addressConfigured ? "not-checked" : "not-configured" },
    failure: null,
  };

  let rpc;
  try {
    rpc = new URL(rpcUrl);
  } catch (_) {
    result.status = "invalid-local-configuration";
    result.failure = "invalid-rpc-url";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }
  if (rpc.protocol !== "http:" || !localHost(rpc.hostname) || rpc.username || rpc.password) {
    result.status = "blocked-non-local-endpoint";
    result.failure = "local-rpc-required";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }

  let provider;
  try {
    provider = providerFactory(rpc.href);
    const network = await within(provider.getNetwork(), timeoutMs);
    result.reachable = true;
    result.chainId = Number(network.chainId);
    if (result.chainId !== 31337) {
      result.status = "wrong-chain";
      result.contract.status = addressConfigured ? "wrong-chain" : "not-configured";
      result.failure = "expected-local-hardhat-chain-31337";
      return result;
    }

    result.blockNumberBefore = await within(provider.getBlockNumber(), timeoutMs);
    // Hardhat mines on demand rather than advancing an idle chain. This empty block
    // probe verifies local mining without sending a contract transaction or changing
    // application state.
    await within(provider.send("evm_mine", []), timeoutMs);
    result.blockNumber = await within(provider.getBlockNumber(), timeoutMs);
    result.blockProgressed = result.blockNumber > result.blockNumberBefore;
    result.healthy = result.blockProgressed;
    result.status = result.healthy ? "healthy" : "not-progressing";
    if (!result.blockProgressed) result.failure = "block-number-did-not-advance";

    if (!addressConfigured) return result;
    const code = await within(provider.getCode(contractAddress), timeoutMs);
    result.contract.deployed = code !== "0x";
    result.contract.healthy = artifactAvailable && result.contract.deployed;
    result.contract.status = !artifactAvailable ? "abi-artifact-missing" : result.contract.deployed ? "ready" : "no-contract-at-configured-address";
  } catch (error) {
    if (result.contract.addressConfigured && result.blockProgressed) {
      result.contract.status = "unavailable";
      result.failure = "contract-lookup-failed";
    } else {
      result.status = result.reachable ? "unhealthy" : "unreachable";
      result.healthy = false;
      result.failure = error.message === "timeout" ? "check-timeout" : "rpc-check-failed";
      if (result.contract.addressConfigured) result.contract.status = result.reachable ? "unavailable" : "unreachable";
    }
  } finally {
    try { provider?.destroy?.(); } catch (_) { /* cleanup must not mask the health result */ }
    result.latencyMs = elapsedSince(startedAt);
  }
  return result;
}

async function aiServiceHealth({
  baseUrl = process.env.AI_BASE_URL || "http://127.0.0.1:8000",
  post = axios.post,
  timeoutMs = AI_DECISION_TIMEOUT_MS,
} = {}) {
  const startedAt = Date.now();
  const result = {
    service: "FastAPI AI service",
    check: "synthetic advisory decision request",
    status: "unavailable",
    reachable: false,
    healthy: false,
    latencyMs: null,
    failure: null,
  };
  let base;
  try {
    base = new URL(baseUrl);
  } catch (_) {
    result.status = "invalid-local-configuration";
    result.failure = "invalid-ai-url";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }
  if (base.protocol !== "http:" || !localHost(base.hostname) || base.username || base.password) {
    result.status = "blocked-non-local-endpoint";
    result.failure = "local-ai-service-required";
    result.latencyMs = elapsedSince(startedAt);
    return result;
  }

  const basePath = base.pathname.replace(/\/+$/, "");
  const url = `${base.origin}${basePath}/decision/decide`;
  const syntheticRequest = {
    social_text: "Synthetic local readiness check; no user or live-feed data.",
    vaccination_history: [1, 2, 3, 4, 5, 6],
    historical_data: [1, 2, 3, 4, 5, 6],
    current_stock: 100,
    target_center: "READINESS-CHECK",
  };
  try {
    const response = await within(post(url, syntheticRequest, { timeout: timeoutMs }), timeoutMs);
    result.reachable = true;
    const decision = response.data?.decision;
    result.healthy = response.status >= 200 && response.status < 300 && response.data?.advisory_only === true &&
      Number.isFinite(decision?.forecast_demand) && Number.isFinite(decision?.recommended_units) && typeof decision?.risk_flag === "boolean";
    result.status = result.healthy ? "healthy" : "invalid-response";
    if (!result.healthy) result.failure = "decision-response-invalid";
  } catch (error) {
    if (error.response) {
      result.reachable = true;
      result.status = "unhealthy";
      result.failure = "ai-service-error-response";
    } else {
      result.status = error.message === "timeout" || error.code === "ECONNABORTED" ? "timeout" : "unreachable";
      result.failure = error.message === "timeout" || error.code === "ECONNABORTED" ? "check-timeout" : "ai-request-failed";
    }
  }
  result.latencyMs = elapsedSince(startedAt);
  return result;
}

exports.getSystemReadiness = async (_req, res) => {
  const startedAt = Date.now();
  const [database, blockchain, ai] = await Promise.all([
    databaseHealth(),
    blockchainHealth(),
    aiServiceHealth(),
  ]);
  return res.json({
    checkedAt: new Date().toISOString(),
    backend: { service: "backend API", status: "healthy", reachable: true, healthy: true, latencyMs: elapsedSince(startedAt) },
    database,
    blockchain,
    ai,
  });
};

exports.databaseHealth = databaseHealth;
exports.blockchainHealth = blockchainHealth;
exports.blockchainStatus = blockchainHealth;
exports.aiServiceHealth = aiServiceHealth;
