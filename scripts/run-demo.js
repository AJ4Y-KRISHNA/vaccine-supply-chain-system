const { ensureStack, seed } = require("./lib/compose");

try {
  ensureStack();
  seed();
  console.log("Synthetic demo is ready: dashboards http://localhost:3000 and field panel http://localhost:5173");
  console.log("All role accounts use DEMO_SEED_PASSWORD in the ignored root .env. Synthetic data only; not for clinical use.");
} catch (error) {
  console.error(`Demo startup failed: ${error.message}`);
  process.exitCode = 1;
}
