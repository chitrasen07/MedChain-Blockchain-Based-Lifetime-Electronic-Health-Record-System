const jwt = require("jsonwebtoken");

function issueToken(user, secret) {
  return jwt.sign({ sub: user.id, role: user.role, hospitalId: user.hospital_id }, secret, { expiresIn: "15m" });
}

function requireAuth(secret, roles = [], { loadUser } = {}) {
  return (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) return res.status(401).json({ error: "Authentication required" });
      const claims = jwt.verify(token, secret);
      if (!loadUser) return res.status(503).json({ error: "Authentication unavailable" });
      Promise.resolve(loadUser(claims.sub)).then((user) => {
        if (!user || user.status !== "active") return res.status(401).json({ error: "Authentication required" });
        if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: "Insufficient permissions" });
        req.user = user;
        next();
      }).catch(next);
    } catch {
      res.status(401).json({ error: "Authentication required" });
    }
  };
}

module.exports = { issueToken, requireAuth };
