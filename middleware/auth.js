const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Please sign in first." });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId).select("-passwordHash");
    if (!user) return res.status(401).json({ message: "Account not found." });
    req.user = user;
    next();
  } catch (_err) {
    return res.status(401).json({ message: "Invalid or expired session. Please sign in again." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ message: "Administrator access required." });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
