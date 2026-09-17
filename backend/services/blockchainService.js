const { ethers } = require("ethers");
let txQueue = Promise.resolve();
let provider;
function configuration(role = "writer") {
  const rpc = new URL(process.env.RPC_URL || "http://127.0.0.1:8545");
  if (rpc.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(rpc.hostname) || rpc.username || rpc.password) {
    throw new Error("This software prototype only supports a loopback local blockchain RPC");
  }
  if (!ethers.isAddress(process.env.CONTRACT_ADDRESS || "")) throw new Error("Configure the deployed local CONTRACT_ADDRESS");
  const abi = require("../../blockchain/artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json").abi;
  provider ||= new ethers.JsonRpcProvider(rpc.href);
  const variable = { writer: "PRIVATE_KEY", production: "PRODUCTION_PRIVATE_KEY", lab: "LAB_PRIVATE_KEY" }[role];
  let key = process.env[variable];
  // Explicitly opted-in PUBLIC Hardhat accounts: never fund or use outside chain 31337.
  if (process.env.LOCAL_CHAIN_DEMO === "true") {
    key = ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined,
      "m/44'/60'/0'/0/" + { writer: 0, production: 1, lab: 2 }[role]).privateKey;
  }
  return { abi, address: process.env.CONTRACT_ADDRESS, key };
}
async function contractFor(role, write = false) {
  const config = configuration(role);
  if ((await provider.getNetwork()).chainId !== 31337n) throw new Error("Local chain ID 31337 required");
  if (await provider.getCode(config.address) === "0x") throw new Error("No contract deployed at configured address");
  if (write && !config.key) throw new Error("Configure a local " + role + " signing key");
  return new ethers.Contract(config.address, config.abi, write ? new ethers.Wallet(config.key, provider) : provider);
}
function write(method, args, role = "writer") {
  const next = txQueue.then(async () => {
    const contract = await contractFor(role, true);
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
const recordOnBlockchain = data => write("recordDistribution", [String(data.targetCenter || "Unknown Center"), whole(data.recommended_units || 0), String(data.priority_score || data.status || data.risk_flag || "Stable")]);
const registerBatchOnChain = (id, type, quantity) => write("registerBatch", [id, type, whole(quantity)]);
const mintInventoryCertificateOnChain = (id, type, demand, uri) => write("mintInventoryCertificate", [id, type, whole(demand), uri || ""]);
const approveBatchReleaseOnChain = (id, role) => {
  if (!["Production", "Lab Testing"].includes(role)) throw new Error("Invalid release role");
  return write("approveBatchRelease", [id, role], role === "Production" ? "production" : "lab");
};
const updateBatchStatusOnChain = (id, status) => write("updateBatchStatus", [id, status]);
const logLifecycleEventOnChain = ({ batchId, actorRole, action, location = "", details = "", quantity = 0 }) =>
  write("logLifecycleEvent", [String(batchId), String(actorRole), String(action), String(location), String(details), whole(quantity)]);
async function getBatchFromChain(id) {
  const row = await (await contractFor("writer")).getBatch(id);
  if (!row[0]) return null;
  return { batchId: row[0], vaccineType: row[1], quantity: Number(row[2]), manufacturer: row[3], status: row[4] };
}
async function getBatchLifecycleFromChain(id) {
  const contract = await contractFor("writer"), count = Number(await contract.getLifecycleCount(id));
  const lifecycle = [];
  for (let index = 0; index < count; index++) {
    const row = await contract.getLifecycleEvent(id, index);
    lifecycle.push({ batchId: row[0], actorRole: row[1], action: row[2], location: row[3], details: row[4], quantity: Number(row[5]), timestamp: Number(row[6]), actor: row[7] });
  }
  return { batchId: id, batch: await getBatchFromChain(id), lifecycleCount: count, lifecycle };
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
module.exports = { recordOnBlockchain, registerBatchOnChain, mintInventoryCertificateOnChain, approveBatchReleaseOnChain,
  logLifecycleEventOnChain, updateBatchStatusOnChain, getBatchFromChain, getBatchLifecycleFromChain,
  getInventoryCertificateFromChain, getBatchReleaseStateFromChain, extractHash, anchorAuditOnChain, verifyAuditOnChain };
