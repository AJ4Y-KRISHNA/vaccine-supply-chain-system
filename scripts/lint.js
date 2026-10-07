const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const skipped = new Set(["node_modules", ".git", "artifacts", "cache", "coverage"]);
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!skipped.has(entry.name)) collect(path.join(directory, entry.name)); }
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path.join(directory, entry.name));
  }
}
for (const directory of ["backend", "blockchain", "scripts"]) collect(path.join(root, directory));
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failures++;
    process.stderr.write(`${path.relative(root, file)}\n${result.stderr || result.stdout}`);
  }
}
if (failures) process.exitCode = 1;
else console.log(`JavaScript syntax lint passed (${files.length} backend, blockchain and runner files).`);
