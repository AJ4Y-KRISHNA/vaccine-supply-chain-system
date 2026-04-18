const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const REFRESH_SECRET = process.env.REFRESH_SECRET || "dev-refresh";

exports.authenticate = (req, res, next) => {
  // Dev bypass: set AUTH_OPTIONAL=true to allow requests without JWT
  if (process.env.AUTH_OPTIONAL === "true") {
    return next();
  }

  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Missing token" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
};

exports.issueToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });

exports.issueRefreshToken = (payload) =>
  jwt.sign(payload, REFRESH_SECRET, { expiresIn: "7d" });

exports.verifyRefresh = (token) =>
  jwt.verify(token, REFRESH_SECRET);
