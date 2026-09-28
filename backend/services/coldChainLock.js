const { AsyncLocalStorage } = require("node:async_hooks");

// Single-process prototype: evaluation, release, simulator ticks and operational
// mutations share the same per-batch queue, including while awaiting IO. A nested
// operation in the same async call may re-enter a lock already held by that call.
const pending = new Map();
const heldLocks = new AsyncLocalStorage();
async function withBatchLock(batchId, work) {
  const key = String(batchId || "");
  const held = heldLocks.getStore();
  if (held?.has(key)) return work();

  const previous = pending.get(key) || Promise.resolve();
  let release;
  const done = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => done);
  pending.set(key, tail);
  await previous.catch(() => {});
  const nested = new Set(held || []);
  nested.add(key);
  try { return await heldLocks.run(nested, work); }
  finally { release(); if (pending.get(key) === tail) pending.delete(key); }
}
module.exports = { withBatchLock };
