const User = require("../models/user");
const bcrypt = require("bcryptjs");
const { issueToken, issueRefreshToken, verifyRefresh } = require("../middleware/auth");

function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "healthcare professional") return "healthcare";
  return normalized;
}

exports.login = async (req, res) => {
  const { email, password, role } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string" || typeof role !== "string" || email.length > 254 || password.length > 128) return res.status(400).json({ message: "Email, password and role must be valid text" });

  try {
    const user = await User.findOne({ email: email.trim(), role: normalizeRole(role) }).select("+password");
    if (!user || user.disabled) {
      return res.status(401).json({ message: "Login failed" });
    }

    const passwordOk = /^\$2[aby]\$/.test(user.password || "") && await bcrypt.compare(password, user.password);

    if (!passwordOk) {
      return res.status(401).json({ message: "Login failed" });
    }

    const identity = { id: user._id, role: user.role, tokenVersion: user.tokenVersion };
    const token = issueToken(identity);
    const refreshToken = issueRefreshToken(identity);

    res.json({
      message: "Login success",
      role: user.role,
      token,
      refreshToken,
      identity: { email: user.email, manufacturer: user.manufacturer, distributor: user.distributor, hospital: user.hospital },
    });

  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
};

exports.refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "Missing refresh token" });
  try {
    const payload = verifyRefresh(refreshToken);
    const user = await User.findById(payload.id);
    if (!user || user.disabled || (user.tokenVersion || 0) !== payload.tokenVersion) throw new Error("Account unavailable");
    const token = issueToken({ id: user._id, role: user.role, tokenVersion: user.tokenVersion });
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: "Invalid refresh token" });
  }
};
