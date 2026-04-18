const { ethers } = require("ethers");

// Fallback empty ABI for compilation safety if artifact isn't generated yet
let contractABI = [];
try {
    contractABI = require("../../blockchain/artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json").abi;
} catch (e) {
    console.warn("VaccineSupplyChain artifact not found. Please compile hardhat contracts.");
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
const privateKey =
    process.env.PRIVATE_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Use fallback address if not provided
const contractAddress = process.env.CONTRACT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const readContract = new ethers.Contract(contractAddress, contractABI, provider);
let txQueue = Promise.resolve();
let nextNonce = null;

function createWallet() {
    return new ethers.Wallet(privateKey, provider);
}

function shouldResetNonce(error) {
    const message = String(error?.message || "").toLowerCase();
    return error?.code === "NONCE_EXPIRED" || message.includes("nonce too low") || message.includes("nonce has already been used");
}

async function allocateNonce(address) {
    if (nextNonce === null) {
        nextNonce = await provider.getTransactionCount(address, "pending");
    }
    const current = nextNonce;
    nextNonce += 1;
    return current;
}

async function enqueueWrite(executor) {
    const next = txQueue.then(async () => {
        const wallet = createWallet();
        const contract = new ethers.Contract(contractAddress, contractABI, wallet);
        try {
            const nonce = await allocateNonce(wallet.address);
            return await executor(contract, nonce);
        } catch (error) {
            if (shouldResetNonce(error)) {
                nextNonce = null;
                const retryNonce = await allocateNonce(wallet.address);
                return executor(contract, retryNonce);
            }
            throw error;
        }
    });

    txQueue = next.catch(() => undefined);
    return next;
}

function mockReceipt(label) {
    console.warn(`Mocking blockchain commit for ${label} due to missing ABI/Contract.`);
    return {
        hash: "0x" + Math.random().toString(16).slice(2, 18) + "...",
        transactionHash: "0x" + Math.random().toString(16).slice(2, 18) + "...",
    };
}

function extractHash(receipt) {
    return receipt?.hash || receipt?.transactionHash || "";
}

function toWholeNumber(value) {
    const parsed = Math.floor(Number(value) || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

async function recordOnBlockchain(decisionData) {
    try {
        const priorityValue =
          decisionData.priority_score ||
          decisionData.status ||
          decisionData.risk_flag ||
          "Stable";

        const targetCenter = decisionData.targetCenter || "Unknown Center";
        const recommendedUnits = toWholeNumber(decisionData.recommended_units);

        if (!readContract.recordDistribution) {
            return mockReceipt("distribution");
        }

        return enqueueWrite(async (contract, nonce) => {
            const tx = await contract.recordDistribution(
                targetCenter,
                recommendedUnits,
                String(priorityValue),
                { nonce }
            );
            return tx.wait();
        });
    } catch (error) {
        console.error("Blockchain commit failed:", error);
        throw error;
    }
}

async function registerBatchOnChain(batchId, vaccineType, quantity) {
    if (!readContract.registerBatch) {
        return mockReceipt("batch registration");
    }
    return enqueueWrite(async (contract, nonce) => {
        const tx = await contract.registerBatch(batchId, vaccineType, quantity, { nonce });
        return tx.wait();
    });
}

async function mintInventoryCertificateOnChain(batchId, vaccineType, predictedDemand, certificateUri) {
    if (!readContract.mintInventoryCertificate) {
        return mockReceipt("inventory certificate");
    }

    return enqueueWrite(async (contract, nonce) => {
        const tx = await contract.mintInventoryCertificate(
            String(batchId || "UNTRACKED"),
            String(vaccineType || "Unknown"),
            toWholeNumber(predictedDemand),
            String(certificateUri || ""),
            { nonce }
        );
        return tx.wait();
    });
}

async function approveBatchReleaseOnChain(batchId, role) {
    if (!readContract.approveBatchRelease) {
        return mockReceipt("batch release approval");
    }

    return enqueueWrite(async (contract, nonce) => {
        const tx = await contract.approveBatchRelease(
            String(batchId || "UNTRACKED"),
            String(role || "Production"),
            { nonce }
        );
        return tx.wait();
    });
}

async function logLifecycleEventOnChain({
    batchId,
    actorRole,
    action,
    location = "",
    details = "",
    quantity = 0,
}) {
    if (!readContract.logLifecycleEvent) {
        return mockReceipt(`${actorRole || "unknown"} lifecycle event`);
    }

    return enqueueWrite(async (contract, nonce) => {
        const tx = await contract.logLifecycleEvent(
            String(batchId || "UNTRACKED"),
            String(actorRole || "System"),
            String(action || "State Change"),
            String(location || "Unknown"),
            String(details || ""),
            toWholeNumber(quantity),
            { nonce }
        );
        return tx.wait();
    });
}

async function updateBatchStatusOnChain(batchId, status) {
    if (!readContract.updateBatchStatus) {
        return mockReceipt("batch status update");
    }

    return enqueueWrite(async (contract, nonce) => {
        const tx = await contract.updateBatchStatus(
            String(batchId || "UNTRACKED"),
            String(status || "Updated"),
            { nonce }
        );
        return tx.wait();
    });
}

async function getBatchFromChain(batchId) {
    const normalizedBatchId = String(batchId || "");
    if (!readContract.getBatch) {
        return {
            batchId: normalizedBatchId,
            vaccineType: "",
            quantity: 0,
            manufacturer: "",
            status: "Unavailable",
        };
    }

    try {
        const batch = await readContract.getBatch(normalizedBatchId);
        return {
            batchId: batch?.[0] || normalizedBatchId,
            vaccineType: batch?.[1] || "",
            quantity: Number(batch?.[2] || 0),
            manufacturer: batch?.[3] || "",
            status: batch?.[4] || "",
        };
    } catch (_error) {
        return {
            batchId: normalizedBatchId,
            vaccineType: "",
            quantity: 0,
            manufacturer: "",
            status: "Lifecycle Only",
        };
    }
}

async function getBatchLifecycleFromChain(batchId) {
    const normalizedBatchId = String(batchId || "");

    if (!readContract.getLifecycleCount || !readContract.getLifecycleEvent) {
        return {
            batchId: normalizedBatchId,
            batch: await getBatchFromChain(normalizedBatchId),
            lifecycleCount: 0,
            lifecycle: [],
        };
    }

    const lifecycleCount = Number(await readContract.getLifecycleCount(normalizedBatchId));
    const lifecycle = [];

    for (let index = 0; index < lifecycleCount; index += 1) {
        const event = await readContract.getLifecycleEvent(normalizedBatchId, index);
        lifecycle.push({
            batchId: event?.[0] || normalizedBatchId,
            actorRole: event?.[1] || "",
            action: event?.[2] || "",
            location: event?.[3] || "",
            details: event?.[4] || "",
            quantity: Number(event?.[5] || 0),
            timestamp: Number(event?.[6] || 0),
            actor: event?.[7] || "",
        });
    }

    return {
        batchId: normalizedBatchId,
        batch: await getBatchFromChain(normalizedBatchId),
        lifecycleCount,
        lifecycle,
    };
}

async function getInventoryCertificateFromChain(batchId) {
    const normalizedBatchId = String(batchId || "");
    if (!readContract.getInventoryCertificate) {
        return {
            batchId: normalizedBatchId,
            vaccineType: "",
            predictedDemand: 0,
            certificateUri: "",
            issuedAt: 0,
            issuer: "",
        };
    }

    try {
        const cert = await readContract.getInventoryCertificate(normalizedBatchId);
        return {
            batchId: cert?.[0] || normalizedBatchId,
            vaccineType: cert?.[1] || "",
            predictedDemand: Number(cert?.[2] || 0),
            certificateUri: cert?.[3] || "",
            issuedAt: Number(cert?.[4] || 0),
            issuer: cert?.[5] || "",
        };
    } catch (_error) {
        return {
            batchId: normalizedBatchId,
            vaccineType: "",
            predictedDemand: 0,
            certificateUri: "",
            issuedAt: 0,
            issuer: "",
        };
    }
}

async function getBatchReleaseStateFromChain(batchId) {
    const normalizedBatchId = String(batchId || "");
    if (!readContract.getReleaseState) {
        return {
            productionApproved: false,
            labApproved: false,
            releaseVisible: false,
            status: "Unavailable",
        };
    }

    try {
        const state = await readContract.getReleaseState(normalizedBatchId);
        return {
            productionApproved: Boolean(state?.[0]),
            labApproved: Boolean(state?.[1]),
            releaseVisible: Boolean(state?.[2]),
            status: state?.[3] || "",
        };
    } catch (_error) {
        return {
            productionApproved: false,
            labApproved: false,
            releaseVisible: false,
            status: "Unavailable",
        };
    }
}

module.exports = {
    recordOnBlockchain,
    registerBatchOnChain,
    mintInventoryCertificateOnChain,
    approveBatchReleaseOnChain,
    logLifecycleEventOnChain,
    updateBatchStatusOnChain,
    getBatchFromChain,
    getBatchLifecycleFromChain,
    getInventoryCertificateFromChain,
    getBatchReleaseStateFromChain,
    extractHash,
};
