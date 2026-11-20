const jwt = require("jsonwebtoken");

const PATIENT_AUDIENCE = "medchain-patient";

function issueToken(user, secret) {
  return jwt.sign({ sub: user.id, role: user.role, hospitalId: user.hospital_id }, secret, { expiresIn: "15m" });
}

function issuePatientToken(patient, walletAddress, secret) {
  return jwt.sign(
    {
      sub: patient.id,
      role: "patient",
      hospitalId: patient.hospital_id,
      patientRef: patient.did,
      walletAddress
    },
    secret,
    { expiresIn: "15m", audience: PATIENT_AUDIENCE }
  );
}

function requireAuth(secret, roles = [], { loadUser } = {}) {
  return (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) return res.status(401).json({ error: "Authentication required" });
      const claims = jwt.verify(token, secret);
      if (claims.role === "patient" || claims.aud === PATIENT_AUDIENCE) {
        return res.status(401).json({ error: "Authentication required" });
      }
      if (!loadUser) return res.status(503).json({ error: "Authentication unavailable" });
      Promise.resolve(loadUser(claims.sub)).then((user) => {
        if (!user || user.status !== "active") return res.status(401).json({ error: "Authentication required" });
        if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: "Insufficient permissions" });
        req.user = { ...user, sub: user.id };
        next();
      }).catch(next);
    } catch {
      res.status(401).json({ error: "Authentication required" });
    }
  };
}

function requirePatient(secret, { loadPatient } = {}) {
  return (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) return res.status(401).json({ error: "Authentication required" });
      const claims = jwt.verify(token, secret, { audience: PATIENT_AUDIENCE });
      if (claims.role !== "patient") return res.status(401).json({ error: "Authentication required" });
      if (!loadPatient) return res.status(503).json({ error: "Authentication unavailable" });
      Promise.resolve(loadPatient(claims.sub)).then((patient) => {
        if (!patient || patient.status !== "confirmed") return res.status(401).json({ error: "Authentication required" });
        if (patient.hospital_id !== claims.hospitalId || patient.did !== claims.patientRef) {
          return res.status(401).json({ error: "Authentication required" });
        }
        if (typeof claims.walletAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(claims.walletAddress)) {
          return res.status(401).json({ error: "Authentication required" });
        }
        req.patient = {
          ...patient,
          walletAddress: claims.walletAddress
        };
        next();
      }).catch(next);
    } catch {
      res.status(401).json({ error: "Authentication required" });
    }
  };
}

module.exports = { issueToken, issuePatientToken, requireAuth, requirePatient, PATIENT_AUDIENCE };
