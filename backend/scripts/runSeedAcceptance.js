// End-to-end seed/login proof using only a uniquely named disposable local DB.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const express = require("express");
const mongoose = require("mongoose");
const { demoUsers } = require("./seed");

const dbName = `codex_seed_test_${randomBytes(8).toString("hex")}`;
let server;
let seedChild;

function runSeedProcess(mongoUri, password) {
  return new Promise((resolve, reject) => {
    seedChild = spawn(process.execPath, [path.resolve(__dirname, "../../scripts/seed.js")], {
      cwd: path.resolve(__dirname, "../.."),
      windowsHide: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, MONGO_URI: mongoUri, DEMO_SEED_PASSWORD: password },
    });
    seedChild.once("error", reject);
    seedChild.once("exit", code => code === 0 ? resolve() : reject(new Error(`Seed script exited with code ${code}`)));
  });
}

async function closeServer() {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  server = null;
}

async function main() {
  if (!process.argv.includes("--execute")) {
    throw new Error("Run with --execute to seed, verify logins, and drop one uniquely named disposable MongoDB database");
  }
  const port = Number(process.env.MONGO_HOST_PORT || 27017);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MONGO_HOST_PORT must be a valid local port");
  const mongoUri = `mongodb://127.0.0.1:${port}/${dbName}`;
  const password = `Synthetic-${randomBytes(24).toString("hex")}`;

  try {
    await runSeedProcess(mongoUri, password);
    process.env.NODE_ENV = "test";
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    const app = express();
    app.use(express.json());
    app.use("/api/auth", require("../routes/authRoutes"));
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
      listener.once("error", reject);
    });

    const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth/login`;
    for (const user of demoUsers) {
      const response = await fetch(baseUrl, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, password, role: user.role }) });
      const body = await response.json();
      assert.equal(response.status, 200, `${user.role} demo account did not sign in`);
      assert.equal(body.role, user.role);
      assert.equal(typeof body.token, "string");
      assert.equal(typeof body.refreshToken, "string");
    }
    console.log("PASS: repeatable synthetic seed completed and Admin, Manufacturer, Distributor, and Healthcare login routes returned valid sessions.");
    console.log("PASS: all proof records were written only to a disposable local test database.");
  } finally {
    await closeServer();
    if (mongoose.connection.readyState && mongoose.connection.name === dbName && /^codex_seed_test_[a-f0-9]{16}$/.test(dbName)) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
    if (seedChild && seedChild.exitCode === null) seedChild.kill();
    console.log("Cleaned only this run's isolated seed/login database; application database unchanged.");
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
