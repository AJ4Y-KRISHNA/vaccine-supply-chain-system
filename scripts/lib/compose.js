const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

function ensureLocalEnv() {
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) return false;
  const secret = () => randomBytes(32).toString("base64url");
  const values = {
    JWT_SECRET: secret(), REFRESH_SECRET: secret(), TEMP_API_KEY: secret(),
    EDGE_GATEWAY_API_KEY: secret(), EDGE_GATEWAY_DEVICE_SECRET: secret(),
    MQTT_USERNAME: "synthetic-demo", MQTT_PASSWORD: secret(), REDIS_PASSWORD: secret(),
    DEMO_SEED_PASSWORD: secret(),
  };
  fs.writeFileSync(envPath, `# Generated for this local synthetic demo. Do not commit.\n${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { mode: 0o600, flag: "wx" });
  console.log("Created ignored .env with fresh local-only secrets. Nothing was printed.");
  return true;
}

function compose(args, options = {}) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: root, stdio: "inherit", windowsHide: true, ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker compose ${args[0]} failed (exit ${result.status ?? "unknown"})`);
}

function ensureStack() {
  ensureLocalEnv();
  // Hardhat is an in-memory chain. Rebuilding its image also recreates the node
  // and discards its history, so an already-running node is intentionally reused.
  const chain = spawnSync("docker", ["compose", "ps", "--status", "running", "-q", "hardhat"], {
    cwd: root, encoding: "utf8", windowsHide: true,
  });
  if (chain.error) throw chain.error;
  if (chain.status !== 0) throw new Error("Unable to inspect the Compose Hardhat service");
  const hardhatIsRunning = Boolean(chain.stdout.trim());
  if (!hardhatIsRunning) {
    compose(["up", "--build", "--detach", "--wait", "--wait-timeout", "360"]);
    return;
  }
  // Only services whose source/build inputs this phase changed are rebuilt.
  // API, external worker and gateway share backend build inputs. Rebuilding only
  // the API would leave deployed consumers/edge math on an older snapshot.
  compose(["build", "backend", "worker", "edge-gateway", "ai-service"]);
  compose(["up", "--no-deps", "--detach", "--wait", "--wait-timeout", "360", "backend", "worker", "edge-gateway", "ai-service"]);
  compose(["up", "--detach", "--wait", "--wait-timeout", "360"]);
}

function seed() {
  compose(["exec", "-T", "backend", "node", "scripts/seed.js"]);
}

module.exports = { root, ensureLocalEnv, ensureStack, seed, compose };
