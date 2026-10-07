const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dotenv = require(path.join(root, "backend/node_modules/dotenv"));
dotenv.config({ path: path.join(root, ".env"), quiet: true });
const base = `http://127.0.0.1:${process.env.BACKEND_HOST_PORT || 5000}/api`;
const batchId = "SYNTHETIC-DEMO-BATCH-A";
const runCompose = args => {
  const result = spawnSync("docker", ["compose", ...args], { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker compose ${args[0]} failed: ${(result.stderr || result.stdout).slice(-1500)}`);
  return result.stdout.trim();
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(url, predicate, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); last = response; if (predicate(response)) return response; } catch (_) {}
    await wait(1000);
  }
  throw new Error(`Timed out waiting for ${url}; last status ${last?.status || "unreachable"}`);
}

async function main() {
  if (!process.env.DEMO_SEED_PASSWORD) throw new Error("DEMO_SEED_PASSWORD must be set in the local .env");
  const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.synthetic.test", password: process.env.DEMO_SEED_PASSWORD, role: "admin" }) });
  if (!login.ok) throw new Error(`Synthetic admin login failed (${login.status}); seed the Compose demo first`);
  const { token } = await login.json();
  const deviceId = `synthetic-worker-restart-${Date.now()}`;
  runCompose(["stop", "worker", "edge-gateway"]);
  try {
    for (const offsetMinutes of [3, 2, 1]) {
      const response = await fetch(`${base}/readings/manual`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ batchId, vehicleId: "SYNTHETIC-TRUCK-01", deviceId,
          temperature: 11, humidity: 60, battery: 90, lat: 9.9, lon: 76.3,
          timestamp: new Date(Date.now() - offsetMinutes * 60000).toISOString(),
          note: "Synthetic worker/API restart acceptance fixture" }) });
      if (response.status !== 202) throw new Error(`Synthetic manual telemetry was not queued (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }
    runCompose(["stop", "backend"]);
    runCompose(["up", "-d", "worker"]);
    runCompose(["exec", "-T", "worker", "node", "scripts/waitForAlert.js", batchId, deviceId]);
    runCompose(["up", "-d", "--no-deps", "--force-recreate", "backend"]);
    await waitFor(`http://127.0.0.1:${process.env.BACKEND_HOST_PORT || 5000}/`, response => response.ok);
    console.log(JSON.stringify({ result: "PASS", synthetic: true, proof: "Alert processed by the separate worker while the API container was stopped, then the API health endpoint recovered." }));
  } finally {
    runCompose(["up", "-d", "worker", "backend", "edge-gateway"]);
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
