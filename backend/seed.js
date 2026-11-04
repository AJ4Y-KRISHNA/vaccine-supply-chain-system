// Backward-compatible entry point for the earlier local seed command.
require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env"), quiet: true });
require("dotenv").config({ path: require("node:path").resolve(__dirname, ".env"), quiet: true });
if (!process.argv.includes("--execute")) {
  throw new Error("Use `npm run seed` (or `node seed.js --execute`) to create synthetic demo fixtures");
}
if (!process.env.DEMO_SEED_PASSWORD && process.env.DEMO_ACCOUNT_PASSWORD) {
  process.env.DEMO_SEED_PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD;
}
require("./scripts/seed").seed().catch(error => {
  console.error(`Synthetic seed failed: ${error.message}`);
  process.exitCode = 1;
});
