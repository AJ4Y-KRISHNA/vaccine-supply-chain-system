const assert = require("node:assert/strict");
const { ethers } = require("hardhat");
describe("Synthetic Merkle root commitments and transport lifecycle", function () {
  let contract, outsider;
  beforeEach(async () => {
    const [, production, lab, stranger] = await ethers.getSigners(); outsider = stranger;
    contract = await (await ethers.getContractFactory("VaccineSupplyChain")).deploy(production.address, lab.address);
    await contract.waitForDeployment();
  });
  it("stores only root metadata and makes identical retries idempotent", async () => {
    const id = ethers.id("window"), root = ethers.id("synthetic root");
    const tx = await contract.anchorSensorRoot(id, "SYNTHETIC-B", root, 1000, 301000, 100);
    const receipt = await tx.wait(); assert.ok(receipt.gasUsed > 0n);
    await contract.anchorSensorRoot(id, "SYNTHETIC-B", root, 1000, 301000, 100);
    const row = await contract.getSensorRoot(id);
    assert.equal(row.root, root); assert.equal(row.count, 100n); assert.equal(row.batchId, "SYNTHETIC-B");
    assert.equal((await contract.queryFilter(contract.filters.SensorRootAnchored())).length, 1);
    assert.equal(await contract.getTemperatureReadingCount("SYNTHETIC-B"), 0n);
    await assert.rejects(contract.anchorSensorRoot(id, "SYNTHETIC-B", ethers.id("tamper"), 1000, 301000, 100), /Root conflict/);
    await assert.rejects(contract.anchorSensorRoot(id, "SYNTHETIC-B", root, 1000, 301000, 99), /Root conflict/);
  });
  it("rejects unauthorized, empty, backwards and oversized anchors", async () => {
    const id = ethers.id("window"), root = ethers.id("root");
    await assert.rejects(contract.connect(outsider).anchorSensorRoot(id, "B", root, 1, 2, 1), /Writer required/);
    await assert.rejects(contract.anchorSensorRoot(ethers.ZeroHash, "B", root, 1, 2, 1), /Empty root/);
    for (const args of [["", 1, 2, 1], ["B", 2, 1, 1], ["B", 1, 2, 101], ["B", 1, 2, 0]]) {
      await assert.rejects(contract.anchorSensorRoot(id, args[0], root, ...args.slice(1)), /Invalid window/);
    }
  });
  it("retains batch/lifecycle APIs and stores explicit transport identifiers", async () => {
    await contract.registerBatch("B", "SYNTHETIC", 10);
    await contract.logTransportLifecycle(["B", "Distributor", "Dispatch", "Kochi", "Synthetic delivery", 10, 0, ethers.ZeroAddress], ["SHIP-1", "TRUCK-1", "KOCHI-DEMO"]);
    assert.equal((await contract.getBatch("B"))[0], "B");
    const index = Number(await contract.getLifecycleCount("B")) - 1;
    const row = await contract.getLifecycleTransport("B", index);
    assert.deepEqual([...row], ["SHIP-1", "TRUCK-1", "KOCHI-DEMO"]);
    assert.equal((await contract.getLifecycleEvent("B", index))[2], "Dispatch");
  });
});
