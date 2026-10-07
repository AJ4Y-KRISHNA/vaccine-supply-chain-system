const { createHash } = require("node:crypto");
const hash = value => "0x" + createHash("sha256").update(value).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
// Exclude mutable policy/AI projections. Commit raw values, provenance and identity.
function payload(reading) {
  const row = JSON.parse(JSON.stringify(reading));
  const keys = ["_id", "batchId", "shipmentId", "sensorId", "deviceId", "vehicleId", "sequenceNumber",
    "eventId", "correlationId", "source", "enteredBy", "note", "needsReview", "supersedes", "overrideId", "operatorUserId", "temperature", "humidity",
    "batteryLevel", "recordedAt", "location", "simulation", "edge", "isDemo", "demoProvenance"];
  return { schema: "synthetic-sensor-merkle-v1", record: Object.fromEntries(keys.filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]])) };
}
const leafHash = reading => hash(Buffer.concat([Buffer.from([0]), Buffer.from(canonical(payload(reading)))]));
const parentHash = (left, right) => hash(Buffer.concat([Buffer.from([1]), Buffer.from(left.slice(2), "hex"), Buffer.from(right.slice(2), "hex")]));
function build(leaves) {
  if (!leaves.length) throw new Error("Empty Merkle tree");
  const levels = [leaves];
  while (levels.at(-1).length > 1) {
    const prior = levels.at(-1), next = [];
    for (let i = 0; i < prior.length; i += 2) next.push(parentHash(prior[i], prior[i + 1] || prior[i]));
    levels.push(next);
  }
  return { root: levels.at(-1)[0], proofs: leaves.map((_, index) => {
    const proof = []; let cursor = index;
    for (const level of levels.slice(0, -1)) {
      const sibling = cursor ^ 1;
      proof.push({ side: cursor % 2 ? "left" : "right", hash: level[sibling] || level[cursor] });
      cursor = Math.floor(cursor / 2);
    }
    return proof;
  }) };
}
function verify(leaf, proof, root) {
  if (!/^0x[0-9a-f]{64}$/i.test(leaf || "") || !Array.isArray(proof)) return false;
  let current = leaf;
  for (const entry of proof) {
    if (!["left", "right"].includes(entry.side) || !/^0x[0-9a-f]{64}$/i.test(entry.hash || "")) return false;
    current = entry.side === "left" ? parentHash(entry.hash, current) : parentHash(current, entry.hash);
  }
  return current === root;
}
module.exports = { canonical, hash, payload, leafHash, parentHash, build, verify };
