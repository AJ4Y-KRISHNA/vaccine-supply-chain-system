const { ensureStack, seed } = require("./lib/compose");
const fs = require("node:fs");
const path = require("node:path");

try {
  ensureStack();
  seed();
  const env = fs.readFileSync(path.resolve(__dirname, "../.env"), "utf8");
  const frontendPort = env.match(/^FRONTEND_HOST_PORT=(\d+)\s*$/m)?.[1] || "3000";
  console.log(`Synthetic demo is ready: dashboards http://localhost:${frontendPort} and field panel http://localhost:5173`);
  console.log("All role accounts use DEMO_SEED_PASSWORD in the ignored root .env. Synthetic data only; not for clinical use.");
} catch (error) {
  console.error(`Demo startup failed: ${error.message}`);
  process.exitCode = 1;
}
