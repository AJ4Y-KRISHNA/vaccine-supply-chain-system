// Opt-in local upgrade. Never restarts the node or overwrites the original batch contract.
const { ethers } = require("ethers"), fs = require("node:fs/promises"), path = require("node:path");
async function main() {
  if (!process.argv.includes("--execute")) throw new Error("Use --execute to deploy a companion on the existing local chain");
  const url = new URL(process.env.RPC_URL || "http://127.0.0.1:8545");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "hardhat"].includes(url.hostname)) throw new Error("Local RPC only");
  const provider = new ethers.JsonRpcProvider(url.href);
  try {
    if (BigInt(await provider.send("eth_chainId", [])) !== 31337n) throw new Error("Local Hardhat only");
    const artifact = require("../artifacts/contracts/VaccineSupplyChain.sol/VaccineSupplyChain.json");
    const ledger = path.join(process.env.COMPANION_METADATA_DIR || "/shared-artifacts", "merkle-companion.json");
    try {
      const prior = JSON.parse(await fs.readFile(ledger, "utf8"));
      const code = await provider.getCode(prior.address);
      if (code !== "0x" && ethers.keccak256(code) === prior.codeHash) {
        await new ethers.Contract(prior.address, artifact.abi, provider).getSensorRoot(ethers.ZeroHash);
        console.log("MERKLE_CONTRACT_ADDRESS=" + prior.address); return;
      }
    } catch (_) { /* No verified deployment: create a new companion only. */ }
    const wallet = i => ethers.HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/" + i).connect(provider);
    const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet(0)).deploy(wallet(1).address, wallet(2).address);
    await contract.waitForDeployment(); const address = await contract.getAddress();
    await fs.mkdir(path.dirname(ledger), { recursive: true });
    await fs.writeFile(ledger, JSON.stringify({ address, chainId: 31337, codeHash: ethers.keccak256(await provider.getCode(address)), synthetic: true }, null, 2));
    console.log("MERKLE_CONTRACT_ADDRESS=" + address);
  } finally { provider.destroy(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
