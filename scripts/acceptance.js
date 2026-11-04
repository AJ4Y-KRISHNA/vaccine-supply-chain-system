const { ensureStack, seed, compose } = require("./lib/compose");

try {
  ensureStack();
  seed();
  compose(["exec", "-T", "backend", "node", "scripts/phase7ComposeAcceptance.js"]);
  const workerProof = require("node:child_process").spawnSync(process.execPath,
    [require("node:path").join(__dirname, "worker-api-restart-acceptance.js")], { cwd: require("node:path").resolve(__dirname, ".."), stdio: "inherit", windowsHide: true });
  if (workerProof.error) throw workerProof.error;
  if (workerProof.status !== 0) throw new Error(`worker/API restart proof failed (exit ${workerProof.status ?? "unknown"})`);
} catch (error) {
  console.error(`Phase 7 synthetic acceptance failed: ${error.message}`);
  try { compose(["logs", "--tail", "80", "backend", "edge-gateway", "mongo", "redis", "hardhat", "mosquitto"]); } catch (_) {}
  process.exitCode = 1;
}
