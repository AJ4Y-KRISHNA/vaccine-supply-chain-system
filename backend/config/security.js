const { randomBytes } = require("node:crypto");
const testSecrets = {};
function secret(name) {
  const value = process.env[name];
  if (typeof value === "string" && value.length >= 32 && !value.startsWith("replace-")) return value;
  if (process.env.NODE_ENV === "test") return testSecrets[name] ||= randomBytes(32).toString("hex");
  throw new Error(`${name} must be configured with at least 32 random characters`);
}
function validateSecurity() {
  for (const name of ["JWT_SECRET", "REFRESH_SECRET", "TEMP_API_KEY"]) secret(name);
  if (secret("JWT_SECRET") === secret("REFRESH_SECRET")) throw new Error("JWT_SECRET and REFRESH_SECRET must differ");
  if (process.env.AUTH_OPTIONAL === "true") throw new Error("AUTH_OPTIONAL bypass has been removed");
}
module.exports = { secret, validateSecurity };
