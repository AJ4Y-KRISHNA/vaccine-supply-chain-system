const User = require("../models/user");
const bcrypt = require("bcryptjs");
const { issueToken, issueRefreshToken, verifyRefresh } = require("../middleware/auth");

function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "healthcare professional") return "healthcare";
  return normalized;
}

exports.login = async (req, res) => {
  const { email, password, role } = req.body;

  try {
    const user = await User.findOne({ email, role: normalizeRole(role) });
    if (!user) {
      return res.status(401).json({ message: "Login failed" });
    }

    const passwordOk =
      (user.password && user.password.startsWith("$2")) // hashed
        ? await bcrypt.compare(password, user.password)
        : user.password === password;

    if (!passwordOk) {
      return res.status(401).json({ message: "Login failed" });
    }

    const token = issueToken({ id: user._id, role: user.role });
    const refreshToken = issueRefreshToken({ id: user._id, role: user.role });

    res.json({
      message: "Login success",
      role: user.role,
      token,
      refreshToken,
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
    const token = issueToken({ id: payload.id, role: payload.role });
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: "Invalid refresh token" });
  }
};
