// Read-only freeze guard. Never print local secret values.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const envFiles = [".env", "backend/.env", "ai-services/.env", "field-operator-panel/.env", "frontend/.env"];
const secrets = new Set();
for (const file of envFiles) {
  if (!fs.existsSync(path.join(root, file))) continue;
  for (const line of fs.readFileSync(path.join(root, file), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !/(SECRET|PASSWORD|API_KEY)/.test(match[1])) continue;
    const value = match[2].replace(/^['"]|['"]$/g, "");
    if (value.length >= 24 && !value.startsWith("replace-")) secrets.add(value);
  }
}
const files = [...new Set(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { cwd: root, windowsHide: true }).toString().split("\0").filter(Boolean))];
const offending = [];
for (const file of files) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
  if (/(^|\/)\.env$|\.(pem|key)$/i.test(file)) { offending.push(file); continue; }
  const bytes = fs.readFileSync(absolute);
  if ([...secrets].some(secret => bytes.includes(Buffer.from(secret)))) offending.push(file);
}
if (offending.length) {
  console.error("Freeze blocked: local-secret matches or private credential files:");
  for (const file of offending) console.error(file);
  process.exitCode = 1;
} else console.log(`PASS: ${files.length} tracked/candidate files checked; no private env files or configured long local secret values found. This is a bounded guard, not a comprehensive security audit.`);
