const jwt = require("jsonwebtoken");

const User = require("../models/user");
const { secret } = require("../config/security");
const options = { algorithms: ["HS256"], issuer: "vaccine-supply-chain", audience: "vaccine-app" };
const claims = payload => ({ id: String(payload.id), role: payload.role, tokenVersion: payload.tokenVersion || 0 });
const sign = (payload, type, name, expiresIn) => jwt.sign({ ...claims(payload), type }, secret(name),
  { algorithm: "HS256", issuer: options.issuer, audience: options.audience, expiresIn });

async function authenticate(req, res, next) {
  const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || "");
  if (!match || match[1].length > 4096) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(match[1], secret("JWT_SECRET"), options);
    if (payload.type !== "access" || !/^[a-f0-9]{24}$/i.test(payload.id || "")) throw new Error("Invalid identity");
    const user = await User.findById(payload.id).select("-password").lean();
    if (!user || user.disabled || !["admin", "manufacturer", "distributor", "healthcare"].includes(user.role) || (user.tokenVersion || 0) !== payload.tokenVersion) throw new Error("Account unavailable");
    req.user = { ...user, id: String(user._id), role: String(user.role).toLowerCase() };
    next();
  } catch (_) { return res.status(401).json({ error: "Invalid or expired credentials" }); }
}
const allowRoles = (...roles) => (req, res, next) => ["admin", ...roles].includes(req.user?.role)
  ? next() : res.status(403).json({ error: "Role cannot access this operation" });
module.exports = { authenticate, allowRoles,
  issueToken: payload => sign(payload, "access", "JWT_SECRET", "1h"),
  issueRefreshToken: payload => sign(payload, "refresh", "REFRESH_SECRET", "7d"),
  verifyRefresh: token => {
    const payload = jwt.verify(token, secret("REFRESH_SECRET"), options);
    if (payload.type !== "refresh") throw new Error("Invalid refresh token");
    return payload;
  },
};
