// Explicit operator replay; receipt checks make committed effects idempotent.
const backbone = require("../services/eventBackbone");
require("dotenv").config();
async function main() {
  const group = process.argv[2];
  if (!backbone.groups.includes(group)) throw new Error("Choose persistence, policy-alert, ai-advisory, or anchoring");
  const redis = await backbone.connection();
  const source = `${backbone.prefix()}:dead-letter:${group}`;
  const entries = await redis.xRange(source, "-", "+", { COUNT: 100 });
  for (const entry of entries) {
    // Redelivers to all groups; completed receipts prevent duplicate effects.
    await redis.multi().xAdd(backbone.stream(), "*", { event: entry.message.event }).xDel(source, entry.id).exec();
  }
  console.log(`Replayed ${entries.length} synthetic dead-letter events; other groups remain idempotent.`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => backbone.stop());
