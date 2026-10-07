const fs = require("node:fs");
const path = require("node:path");
const { ensureStack, seed, compose, root } = require("./lib/compose");

try {
  ensureStack();
  seed();
  const result = composeCapture(["exec", "-T", "backend", "node", "scripts/phase7Evaluate.js"]);
  const match = result.match(/^RESULT_FILE=(.+)$/m);
  if (!match) throw new Error("Evaluation runner did not report its JSON result file");
  const relative = match[1].trim();
  fs.mkdirSync(path.join(root, "results"), { recursive: true });
  compose(["cp", `backend:/workspace/backend/${relative}`, path.join(root, "results", path.basename(relative))]);
  console.log(`Evaluation report saved to ${path.join(root, "results", path.basename(relative))}`);
} catch (error) {
  console.error(`Synthetic evaluation failed: ${error.message}`);
  process.exitCode = 1;
}

function composeCapture(args) {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync("docker", ["compose", ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    throw new Error(`docker compose ${args[0]} failed (exit ${result.status ?? "unknown"})`);
  }
  process.stdout.write(result.stdout || "");
  return result.stdout || "";
}
