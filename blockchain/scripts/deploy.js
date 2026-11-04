const hre = require("hardhat");

async function main() {
  const VaccineSupplyChain = await hre.ethers.getContractFactory("VaccineSupplyChain");
  const [owner, production, lab] = await hre.ethers.getSigners();
  if ((await hre.ethers.provider.getNetwork()).chainId !== 31337n) throw new Error("Deploy only to the local prototype chain (31337)");
  const contract = await VaccineSupplyChain.deploy(production.address, lab.address);

  await contract.waitForDeployment();

  console.log("Contract deployed to:", await contract.getAddress());
  console.log("Local roles:", { owner: owner.address, production: production.address, lab: lab.address });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
