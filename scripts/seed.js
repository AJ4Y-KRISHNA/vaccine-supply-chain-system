// Repository-root entry point for repeatable synthetic local demo data.
// The implementation and its dependencies remain with the backend service.
const { seed } = require("../backend/scripts/seed");

seed().catch(error => {
  console.error(`Synthetic seed failed: ${error.message}`);
  process.exitCode = 1;
});
