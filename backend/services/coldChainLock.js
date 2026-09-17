// Single-process prototype: evaluation, release and operational mutations share
// the same per-batch queue, including while an existing controller is awaiting IO.
const pending = new Map();
async function withBatchLock(batchId, work) {
  const previous = pending.get(batchId) || Promise.resolve();
  let release;
  const done = new Promise((resolve) => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => done);
  pending.set(batchId, tail);
  await previous.catch(() => {});
  try { return await work(); }
  finally { release(); if (pending.get(batchId) === tail) pending.delete(batchId); }
}
module.exports = { withBatchLock };
