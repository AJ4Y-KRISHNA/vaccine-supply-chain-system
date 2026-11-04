// Live diagnostic only. Credentials and bearer tokens never leave this process.
const assert = require("node:assert/strict");

async function main() {
  const password = process.env.DEMO_SEED_PASSWORD;
  assert.ok(password, "Seed password must be configured inside the demo container");
  const base = "http://127.0.0.1:5000";
  const logins = [];
  let adminToken;
  for (const role of ["admin", "manufacturer", "distributor", "healthcare", "field_operator"]) {
    const email = `${role === "field_operator" ? "fieldoperator" : role}@demo.synthetic.test`;
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, role }), signal: AbortSignal.timeout(45000),
    });
    assert.equal(response.status, 200, `${role} login must succeed`);
    const body = await response.json();
    assert.equal(body.role, role);
    if (role === "admin") adminToken = body.token;
    logins.push({ role, email, httpStatus: response.status });
  }
  const response = await fetch(`${base}/api/admin/readiness`, {
    headers: { authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(45000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const checks = {};
  for (const service of ["backend", "database", "mqtt", "redis", "worker", "ai", "blockchain", "email"]) {
    const result = body[service];
    checks[service] = { status: result?.status, healthy: result?.healthy };
    assert.ok(result?.healthy || service === "email" && result?.status === "degraded", `${service} readiness must be healthy (email capture-confirmed degradation allowed)`);
  }
  assert.ok(body.blockchain.contract?.healthy, "Contract bytecode must be present");
  console.log(JSON.stringify({ result: "PASS", synthetic: true, logins, readinessHttpStatus: response.status,
    checks, chainId: body.blockchain.chainId, contract: body.blockchain.contract,
    merkleAnchoring: body.merkleAnchoring, dataMode: body.dataMode }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
