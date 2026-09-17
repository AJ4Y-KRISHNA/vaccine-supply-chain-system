const assert = require("node:assert/strict");
const { ethers } = require("hardhat");
describe("Local chain authorization and immutable audit anchors", function () {
  let contract, owner, production, lab, outsider;
  beforeEach(async () => {
    [owner, production, lab, outsider] = await ethers.getSigners();
    contract = await (await ethers.getContractFactory("VaccineSupplyChain")).deploy(production.address, lab.address);
    await contract.waitForDeployment();
  });
  it("requires distinct nonzero release signers", async () => {
    await assert.rejects((await ethers.getContractFactory("VaccineSupplyChain")).deploy(production.address, production.address), /Distinct release/);
  });
  it("rejects unauthorized mutations and writer administration", async () => {
    const stranger = contract.connect(outsider);
    for (const action of [() => stranger.registerBatch("B", "DEMO", 10), () => stranger.recordDistribution("H", 2, "normal"),
      () => stranger.logLifecycleEvent("B", "Admin", "Clear", "", "", 0), () => stranger.updateBatchStatus("B", "Released"),
      () => stranger.mintInventoryCertificate("B", "DEMO", 1, ""), () => stranger.anchorAudit(ethers.id("A"), ethers.id("digest"))]) {
      await assert.rejects(action(), /Writer required/);
    }
    await assert.rejects(stranger.setWriter(outsider.address, true), /Owner required/);
  });
  it("does not overwrite a batch and needs both independent signer addresses", async () => {
    await contract.registerBatch("B", "DEMO", 10);
    await assert.rejects(contract.registerBatch("B", "DEMO", 99), /already registered/);
    await assert.rejects(contract.approveBatchRelease("B", "Production"), /Production signer/);
    await contract.connect(production).approveBatchRelease("B", "Production");
    assert.equal((await contract.getReleaseState("B"))[2], false);
    await assert.rejects(contract.connect(production).approveBatchRelease("B", "Lab Testing"), /Lab signer/);
    await contract.connect(lab).approveBatchRelease("B", "Lab Testing");
    assert.equal((await contract.getReleaseState("B"))[2], true);
    assert.equal((await contract.getBatch("B"))[2], 10n);
  });
  it("supports writer revocation and idempotent non-overwritable audit anchoring", async () => {
    const event = ethers.id("event"), digest = ethers.id("canonical evidence");
    await contract.setWriter(outsider.address, true);
    await contract.connect(outsider).anchorAudit(event, digest);
    await contract.anchorAudit(event, digest);
    assert.equal(await contract.auditDigests(event), digest);
    await assert.rejects(contract.anchorAudit(event, ethers.id("tampered")), /digest conflict/);
    await contract.setWriter(outsider.address, false);
    await assert.rejects(contract.connect(outsider).anchorAudit(ethers.id("next"), digest), /Writer required/);
    assert.equal((await contract.queryFilter(contract.filters.AuditAnchored())).length, 1);
  });
});
