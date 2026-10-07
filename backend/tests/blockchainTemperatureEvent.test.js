const { ethers } = require("ethers");
const { matchesTemperatureReadingEvent } = require("../services/blockchainService");

const batchId = "SYSTEM-ACCEPTANCE-DEMO";
const recordId = `0x${"2".repeat(64)}`;
const digest = `0x${"3".repeat(64)}`;

test("verifies a TemperatureReadingAppended event with a hashed indexed string batch ID", () => {
  const parsed = { name: "TemperatureReadingAppended", args: {
    recordId, batchId: { hash: ethers.id(batchId) }, digest,
  } };
  expect(matchesTemperatureReadingEvent(parsed, batchId, recordId, digest)).toBe(true);
});

test("rejects temperature events for another batch, record, or digest", () => {
  const parsed = { name: "TemperatureReadingAppended", args: {
    recordId, batchId: { hash: ethers.id(batchId) }, digest,
  } };
  expect(matchesTemperatureReadingEvent(parsed, "OTHER-BATCH", recordId, digest)).toBe(false);
  expect(matchesTemperatureReadingEvent(parsed, batchId, `0x${"4".repeat(64)}`, digest)).toBe(false);
  expect(matchesTemperatureReadingEvent(parsed, batchId, recordId, `0x${"5".repeat(64)}`)).toBe(false);
  expect(matchesTemperatureReadingEvent({ name: "OtherEvent", args: parsed.args }, batchId, recordId, digest)).toBe(false);
});
