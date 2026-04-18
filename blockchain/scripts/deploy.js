const hre = require("hardhat");

async function main() {
  const VaccineSupplyChain = await hre.ethers.getContractFactory("VaccineSupplyChain");
  const contract = await VaccineSupplyChain.deploy();

  await contract.waitForDeployment();

  console.log("Contract deployed to:", await contract.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
