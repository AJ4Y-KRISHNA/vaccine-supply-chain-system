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
  it("stores complete sensor readings append-only and treats identical retries idempotently", async () => {
    await contract.registerBatch("B", "SYNTHETIC", 10);
    const recordId = ethers.id("reading-1"), coder = ethers.AbiCoder.defaultAbiCoder();
    const values = ["B", recordId, "DEVICE-1", "TRUCK-1", "SHIP-1", 1767225900000n,
      5125, 58000, 99500, 9932580, 76268770, true, true, true];
    const commitmentType = "tuple(string batchId,bytes32 recordId,string deviceId,string vehicleId,string shipmentId,uint256 recordedAtMilliseconds,int256 temperatureMilliC,uint256 humidityMilliPercent,uint256 batteryMilliPercent,int256 latitudeMicrodegrees,int256 longitudeMicrodegrees,bool hasHumidity,bool hasBattery,bool hasLocation)";
    const digest = ethers.sha256(coder.encode([commitmentType], [values]));
    const args = [recordId, digest, ...values.slice(0, 1), ...values.slice(2)];
    await contract.recordTemperatureReading(args);
    await contract.recordTemperatureReading(args);
    assert.equal(await contract.getTemperatureReadingCount("B"), 1n);
    const row = await contract.getTemperatureReadingById(recordId);
    assert.equal(row.digest, digest);
    assert.equal(row.batchId, "B");
    assert.equal(row.temperatureMilliC, 5125n);
    assert.equal(row.humidityMilliPercent, 58000n);
    assert.equal(row.batteryMilliPercent, 99500n);
    assert.equal(row.latitudeMicrodegrees, 9932580n);
    assert.equal(row.longitudeMicrodegrees, 76268770n);
    assert.equal(row.recordedAtMilliseconds, 1767225900000n);
    assert.equal((await contract.queryFilter(contract.filters.TemperatureReadingAppended())).length, 1);
    const changedValues = [...values]; changedValues[6] = 6000;
    const changedDigest = ethers.sha256(coder.encode([commitmentType], [changedValues]));
    await assert.rejects(contract.recordTemperatureReading([recordId, changedDigest, ...changedValues.slice(0, 1), ...changedValues.slice(2)]), /Telemetry record conflict/);
    await assert.rejects(contract.recordTemperatureReading([ethers.id("reading-2"), digest, "UNKNOWN", ...values.slice(2)]), /Batch not found/);
  });
  it("appends batch statuses and blocks rewrites of certificate and release sign-offs", async () => {
    await contract.registerBatch("B", "SYNTHETIC", 10);
    await contract.updateBatchStatus("B", "In Transit");
    await contract.updateBatchStatus("B", "Delivered");
    assert.equal(await contract.getBatchStatusCount("B"), 3n);
    assert.equal(await contract.getBatchStatusAt("B", 0), "Awaiting Multi-Sign Release");
    assert.equal(await contract.getBatchStatusAt("B", 1), "In Transit");
    assert.equal((await contract.getBatch("B"))[4], "Delivered");
    await contract.mintInventoryCertificate("B", "SYNTHETIC", 5, "demo://certificate");
    await assert.rejects(contract.mintInventoryCertificate("B", "SYNTHETIC", 9, "demo://changed"), /Certificate already issued/);
    await contract.connect(production).approveBatchRelease("B", "Production");
    await assert.rejects(contract.connect(production).approveBatchRelease("B", "Production"), /already recorded/);
    await contract.connect(lab).approveBatchRelease("B", "Lab Testing");
    assert.equal((await contract.getBatch("B"))[4], "Released to Supply Chain");
    assert.equal(await contract.getBatchStatusCount("B"), 4n);
  });
});
