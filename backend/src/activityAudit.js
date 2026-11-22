const jwt = require("jsonwebtoken");
const { PATIENT_AUDIENCE, requireAuth, requirePatient } = require("./auth");

const VIEW_WINDOW_MS = 15 * 60 * 1000;
const HOSPITAL_ZONE = "Asia/Kolkata";
const CLINICAL_ACTIONS = new Set(["record_created", "record_viewed", "record_corrected", "record_anchored", "summary_exported"]);
const VIEW_ACTIONS = new Set(["record_viewed", "intake_viewed", "PATIENT_LOOKUP", "PROFILE_VIEWED", "VISIT_HISTORY_VIEWED"]);
const FILTERS = ["all", "profile", "records", "changes", "logins", "appointments", "consent"];
const SENSITIVE_KEY = /password|secret|token|jwt|signature|recovery|ciphertext|reason|notes|content|diagnosis|prescription|medication|allergy/i;

const PATIENT_PHRASES = {
  LOGIN_SUCCEEDED: "signed in",
  LOGIN_FAILED: "had a failed sign-in attempt",
  LOGOUT: "signed out",
  SESSION_REVOKED: "ended a session after a password change",
  SESSION_EXPIRED: "had a session expire",
  WALLET_AUTHENTICATED: "signed in with a wallet",
  PATIENT_LOOKUP: "viewed your patient profile",
  PROFILE_VIEWED: "viewed your patient profile",
  record_viewed: "viewed your medical history",
  intake_viewed: "viewed your clinical history",
  VISIT_HISTORY_VIEWED: "viewed your visit history",
  summary_exported: "exported your medical summary",
  record_created: "added a clinical record",
  record_corrected: "updated a clinical record",
  record_anchored: "anchored a medical record",
  demographic_corrected: "corrected your demographics",
  intake_created: "added a clinical note",
  intake_reviewed: "updated a clinical note",
  intake_rejected: "updated a clinical note",
  APPOINTMENT_REQUESTED: "requested an appointment",
  APPOINTMENT_APPROVED: "approved an appointment",
  APPOINTMENT_RESCHEDULED: "rescheduled an appointment",
  APPOINTMENT_REJECTED: "rejected an appointment",
  APPOINTMENT_CANCELLED: "cancelled an appointment",
  APPOINTMENT_COMPLETED: "completed an appointment",
  ACCESS_GRANTED: "granted consent",
  ACCESS_REVOKED: "revoked consent",
  ACCESS_EXPIRED: "had consent expire",
  ACCESS_DENIED: "was denied access",
  EMERGENCY_ACCESS_GRANTED: "used emergency access",
  EMERGENCY_ACCESS_REVOKED: "ended emergency access",
  EMERGENCY_ACCESS_EXPIRED: "had emergency access expire",
  EMERGENCY_PREPARED: "prepared emergency access",
  ROLE_ASSIGNED: "assigned a staff role",
  ROLE_REVOKED: "revoked a staff role",
  ROLE_CHANGED: "changed a staff role",
  USER_DISABLED: "disabled a staff account",
  PATIENT_REGISTERED: "registered a patient",
  PATIENT_REGISTRATION_PENDING: "started a patient registration"
};

const STAFF_PHRASES = {
  ...PATIENT_PHRASES,
  PATIENT_LOOKUP: "viewed a patient profile",
  PROFILE_VIEWED: "viewed a patient profile",
  record_viewed: "viewed a medical history",
  intake_viewed: "viewed a clinical history",
  VISIT_HISTORY_VIEWED: "viewed a visit history",
  summary_exported: "exported a medical summary",
  record_created: "added a clinical record",
  record_corrected: "updated a clinical record",
  demographic_corrected: "corrected patient demographics",
  APPOINTMENT_REQUESTED: "recorded an appointment request",
  APPOINTMENT_APPROVED: "approved an appointment",
  APPOINTMENT_RESCHEDULED: "rescheduled an appointment",
  APPOINTMENT_REJECTED: "rejected an appointment",
  APPOINTMENT_CANCELLED: "cancelled an appointment",
  APPOINTMENT_COMPLETED: "completed an appointment"
};

function categoryFor(action) {
  if (String(action).startsWith("APPOINTMENT_")) return "appointment";
  if (["LOGIN_SUCCEEDED", "LOGIN_FAILED", "LOGOUT", "SESSION_REVOKED", "SESSION_EXPIRED", "WALLET_AUTHENTICATED"].includes(action)) return "login";
  if (["PATIENT_LOOKUP", "PROFILE_VIEWED"].includes(action)) return "profile";
  if (["record_viewed", "intake_viewed", "VISIT_HISTORY_VIEWED", "summary_exported"].includes(action)) return "records";
  if (["record_created", "record_corrected", "record_anchored", "demographic_corrected", "intake_created", "intake_reviewed", "intake_rejected"].includes(action)) return "changes";
  if (String(action).startsWith("ACCESS_") || String(action).startsWith("EMERGENCY_") || action === "WALLET_LINKED") return "consent";
  if (["ROLE_ASSIGNED", "ROLE_REVOKED", "ROLE_CHANGED", "USER_DISABLED", "ACCESS_DENIED"].includes(action)) return "security";
  if (String(action).startsWith("PATIENT_") || String(action).startsWith("MATCH_")) return "registration";
  return "other";
}

function matchesFilter(event, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "profile") return event.category === "profile";
  if (filter === "records") return event.category === "records";
  if (filter === "changes") return event.category === "changes";
  if (filter === "logins") return event.category === "login";
  if (filter === "appointments") return event.category === "appointment";
  if (filter === "consent") return event.category === "consent" || event.category === "security";
  return false;
}

function repeatedView(previous, candidate, now = Date.now()) {
  if (!VIEW_ACTIONS.has(candidate.action)) return false;
  return previous.some((row) => {
    if (row.action !== candidate.action) return false;
    if (String(row.patientId || "") !== String(candidate.patientId || "")) return false;
    if (String(row.actorId || "") !== String(candidate.actorId || "")) return false;
    if (String(row.actorRole || "") !== String(candidate.actorRole || "")) return false;
    return now - new Date(row.createdAt).getTime() < VIEW_WINDOW_MS && now - new Date(row.createdAt).getTime() >= 0;
  });
}

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) safe[key] = value;
  }
  return safe;
}

function formatIst(value) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "Time unavailable";
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: HOSPITAL_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(instant);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: HOSPITAL_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12"
  }).format(instant).replace(/\s*am$/i, " AM").replace(/\s*pm$/i, " PM");
  return `${date}, ${time} IST`;
}

function roleTitle(role) {
  return {
    doctor: "Doctor",
    hospital_staff: "Hospital staff",
    administrator: "Hospital admin",
    receptionist: "Receptionist",
    reviewer: "Reviewer",
    patient: "Patient"
  }[role] || "Staff member";
}

function describeActivity(event, viewer) {
  const phrases = viewer === "patient" ? PATIENT_PHRASES : STAFF_PHRASES;
  const self = viewer === "patient" && event.actorRole === "patient";
  const who = self ? "You" : (event.actorLabel || roleTitle(event.actorRole));
  const did = phrases[event.action] || "recorded an activity";
  const prefix = event.outcome === "denied" ? "Access was denied. " : event.outcome === "failure" ? "This attempt did not succeed. " : "";
  return `${prefix}${who} ${did} — ${formatIst(event.at || event.createdAt)}.`;
}

function presentActivity(row, viewer) {
  const event = {
    id: String(row.id),
    at: new Date(row.createdAt).toISOString(),
    actorId: row.actorId || null,
    actorRole: row.actorRole || null,
    actorLabel: row.actorLabel || null,
    patientId: row.publicPatientId || null,
    resourceId: row.resourceId || null,
    category: row.category || categoryFor(row.action),
    action: row.action,
    outcome: row.outcome || "success",
    source: row.source || "hospital",
    transaction: row.txHash || null,
    metadata: safeMetadata(row.metadata)
  };
  event.summary = describeActivity(event, viewer);
  event.displayTime = formatIst(event.at);
  return event;
}

function pageOf(rows, limit) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    events: page,
    nextCursor: hasMore && last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : null
  };
}

function readCursor(value) {
  if (!value) return null;
  const [stamp, id] = String(value).split("|");
  const time = new Date(stamp);
  if (Number.isNaN(time.getTime()) || !id) return null;
  return { time, id: id.slice(0, 80) };
}

function readFilter(value) {
  return FILTERS.includes(value) ? value : "all";
}

function readLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit)) return 25;
  return Math.min(50, Math.max(1, limit));
}

function requestId(req) {
  const header = String(req.get?.("x-request-id") || "");
  return /^[A-Za-z0-9-]{8,80}$/.test(header) ? header : null;
}

async function recordActivity(db, event) {
  if (!db || typeof db.recordActivity !== "function") return null;
  return db.recordActivity({ ...event, category: event.category || categoryFor(event.action) });
}

function createPgActivityStore(db) {
  const union = `
    SELECT e.id::text AS id, e.created_at AS "createdAt", e.actor_id AS "actorId",
      COALESCE(e.actor_role, u.role) AS "actorRole",
      COALESCE(e.actor_label, u.full_name) AS "actorLabel",
      e.patient_id AS "patientRowId", p.patient_id AS "publicPatientId",
      e.resource_id::text AS "resourceId", e.hospital_id AS "hospitalId",
      COALESCE(e.category, 'other') AS category, e.action,
      COALESCE(e.outcome, 'success') AS outcome, COALESCE(e.source, 'hospital') AS source,
      e.tx_hash AS "txHash", e.metadata
    FROM audit_events e
    LEFT JOIN users u ON u.id = e.actor_id
    LEFT JOIN patients p ON p.id = e.patient_id
    UNION ALL
    SELECT c.id::text, c.created_at, c.actor_id, c.actor_role, u.full_name,
      c.patient_id, p.patient_id, NULL, c.hospital_id,
      CASE c.action
        WHEN 'record_viewed' THEN 'records'
        WHEN 'summary_exported' THEN 'records'
        ELSE 'changes'
      END, c.action, 'success', 'hospital', c.tx_hash, '{}'::jsonb
    FROM clinical_audit_events c
    JOIN patients p ON p.id = c.patient_id
    LEFT JOIN users u ON u.id = c.actor_id
    UNION ALL
    SELECT a.id::text, a.created_at, u.id, COALESCE(u.role, 'clinical'),
      COALESCE(u.full_name, a.actor_wallet), a.patient_id, p.patient_id, NULL, a.hospital_id,
      CASE WHEN a.action_code LIKE 'EMERGENCY_%' OR a.action_code LIKE 'ACCESS_%' THEN 'consent' ELSE 'security' END,
      a.action_code, 'success', 'hospital', a.tx_hash, '{}'::jsonb
    FROM access_audit_events a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN staff_chain_authorizations s ON lower(s.wallet_address) = lower(a.actor_wallet)
    LEFT JOIN users u ON u.id = s.user_id
  `;

  function categoryClause(filter, values) {
    if (!filter || filter === "all") return "";
    const categories = filter === "consent" ? ["consent", "security"] : [filter === "logins" ? "login" : filter];
    values.push(categories);
    return ` AND category = ANY($${values.length}::text[])`;
  }

  async function selectWhere(where, values, limit) {
    const result = await db.query(
      `SELECT * FROM (${union}) events WHERE ${where} ORDER BY "createdAt" DESC, id DESC LIMIT $${values.length + 1}`,
      [...values, limit]
    );
    return result.rows;
  }

  return {
    async listPatient({ patientRowId, hospitalId, before, limit, filter }) {
      const values = [patientRowId, hospitalId];
      let where = `"patientRowId" = $1 AND "hospitalId" = $2${categoryClause(filter, values)}`;
      if (before) {
        values.push(before.time, before.id);
        where += ` AND ("createdAt" < $${values.length - 1} OR ("createdAt" = $${values.length - 1} AND id < $${values.length}))`;
      }
      return selectWhere(where, values, limit);
    },
    async listActor({ actorId, hospitalId, before, limit, filter }) {
      const values = [actorId, hospitalId];
      let where = `"actorId" = $1 AND "hospitalId" = $2${categoryClause(filter, values)}`;
      if (before) {
        values.push(before.time, before.id);
        where += ` AND ("createdAt" < $${values.length - 1} OR ("createdAt" = $${values.length - 1} AND id < $${values.length}))`;
      }
      return selectWhere(where, values, limit);
    },
    async listHospital({ hospitalId, before, limit, filter }) {
      const values = [hospitalId];
      let where = `"hospitalId" = $1${categoryClause(filter, values)}`;
      if (before) {
        values.push(before.time, before.id);
        where += ` AND ("createdAt" < $${values.length - 1} OR ("createdAt" = $${values.length - 1} AND id < $${values.length}))`;
      }
      return selectWhere(where, values, limit);
    }
  };
}

function createMemoryActivityStore() {
  const rows = [];
  return {
    rows,
    async record(event) {
      const candidate = {
        id: `mem-${rows.length + 1}`,
        createdAt: event.createdAt || new Date(),
        actorId: event.actorId || null,
        actorRole: event.actorRole || null,
        actorLabel: event.actorLabel || null,
        patientId: event.patientId || null,
        patientRowId: event.patientRowId || event.patientId || null,
        publicPatientId: event.publicPatientId || null,
        resourceId: event.resourceId || null,
        hospitalId: event.hospitalId || null,
        category: event.category || categoryFor(event.action),
        action: event.action,
        outcome: event.outcome || "success",
        source: event.source || "hospital",
        txHash: event.txHash || null,
        metadata: event.metadata || {}
      };
      if (repeatedView(rows.map((row) => ({ ...row, patientId: row.patientRowId })), {
        action: candidate.action,
        patientId: candidate.patientRowId,
        actorId: candidate.actorId,
        actorRole: candidate.actorRole
      }, candidate.createdAt.getTime())) return { skipped: true };
      rows.push(candidate);
      return candidate;
    },
    async listPatient({ patientRowId, hospitalId, before, limit, filter }) {
      return rows.filter((row) => row.patientRowId === patientRowId && row.hospitalId === hospitalId && afterCursor(row, before) && keep(row, filter))
        .sort(newestFirst).slice(0, limit);
    },
    async listActor({ actorId, hospitalId, before, limit, filter }) {
      return rows.filter((row) => row.actorId === actorId && row.hospitalId === hospitalId && afterCursor(row, before) && keep(row, filter))
        .sort(newestFirst).slice(0, limit);
    },
    async listHospital({ hospitalId, before, limit, filter }) {
      return rows.filter((row) => row.hospitalId === hospitalId && afterCursor(row, before) && keep(row, filter))
        .sort(newestFirst).slice(0, limit);
    }
  };
}

function afterCursor(row, before) {
  if (!before) return true;
  const time = new Date(row.createdAt).getTime();
  const cursor = before.time.getTime();
  if (time < cursor) return true;
  if (time > cursor) return false;
  return String(row.id) < String(before.id);
}

function newestFirst(left, right) {
  const time = new Date(right.createdAt) - new Date(left.createdAt);
  if (time) return time;
  return String(right.id).localeCompare(String(left.id));
}

function keep(row, filter) {
  return matchesFilter({ ...row, category: row.category || categoryFor(row.action) }, filter);
}

function respond(rows, limit, viewer) {
  const page = pageOf(rows, limit);
  return {
    timezone: HOSPITAL_ZONE,
    events: page.events.map((row) => presentActivity(row, viewer)),
    nextCursor: page.nextCursor
  };
}

function registerActivityAudit(app, { db, blockchain, config = {}, store } = {}) {
  const activity = store || createPgActivityStore(db);
  const patient = requirePatient(config.jwtSecret, { loadPatient: (id) => db.getPatientForAuth(id) });
  const doctor = requireAuth(config.jwtSecret, ["doctor"], { loadUser: (id) => db.getUserForAuth(id) });
  const nurse = requireAuth(config.jwtSecret, ["hospital_staff"], { loadUser: (id) => db.getUserForAuth(id) });
  const admin = requireAuth(config.jwtSecret, ["administrator"], { loadUser: (id) => db.getUserForAuth(id) });

  app.get("/patient-portal/activity", patient, async (req, res, next) => {
    try {
      const limit = readLimit(req.query.limit);
      const filter = readFilter(req.query.filter);
      const rows = await activity.listPatient({
        patientRowId: req.patient.id,
        hospitalId: req.patient.hospital_id,
        before: readCursor(req.query.before),
        limit: limit + 1,
        filter
      });
      const body = respond(rows, limit, "patient");
      if (!req.query.before && (filter === "all" || filter === "consent") && typeof blockchain?.listAudit === "function") {
        try {
          const chain = await blockchain.listAudit(req.patient.did);
          const extra = (Array.isArray(chain) ? chain : []).map((entry, index) => presentActivity({
            id: `chain-${index}-${entry.timestamp || 0}`,
            createdAt: entry.timestamp ? new Date(Number(entry.timestamp) * 1000) : new Date(),
            actorLabel: entry.actor,
            actorRole: "clinical",
            action: entry.action,
            outcome: entry.success === false ? "failure" : "success",
            source: "chain",
            category: categoryFor(entry.action)
          }, "patient"));
          body.events = [...extra, ...body.events].sort((left, right) => new Date(right.at) - new Date(left.at));
        } catch { /* Chain history stays on the access page when Sepolia is unavailable. */ }
      }
      res.json(body);
    } catch (error) { next(error); }
  });

  app.get("/doctor/activity", doctor, async (req, res, next) => {
    try {
      const limit = readLimit(req.query.limit);
      const filter = readFilter(req.query.filter);
      if (req.query.patientId) {
        const patientRow = await db.getPatient(String(req.query.patientId), req.user.hospital_id);
        if (!patientRow) return res.status(404).json({ error: "Patient not found" });
        try {
          const { openClinicalAccess } = require("./clinicalRecords");
          await openClinicalAccess({ db, blockchain, userId: req.user.id, patient: patientRow });
        } catch (error) {
          if (error?.statusCode === 403) {
            await recordActivity(db, {
              actorId: req.user.id,
              actorRole: req.user.role,
              hospitalId: req.user.hospital_id,
              patientId: patientRow.id,
              publicPatientId: patientRow.patientId,
              action: "ACCESS_DENIED",
              category: "security",
              outcome: "denied",
              requestId: requestId(req)
            });
            return res.status(403).json({ error: "Patient consent is required." });
          }
          throw error;
        }
        const rows = await activity.listPatient({
          patientRowId: patientRow.id,
          hospitalId: req.user.hospital_id,
          before: readCursor(req.query.before),
          limit: limit + 1,
          filter
        });
        return res.json(respond(rows, limit, "staff"));
      }
      const rows = await activity.listActor({
        actorId: req.user.id,
        hospitalId: req.user.hospital_id,
        before: readCursor(req.query.before),
        limit: limit + 1,
        filter
      });
      res.json(respond(rows, limit, "staff"));
    } catch (error) { next(error); }
  });

  app.get("/staff/activity", nurse, async (req, res, next) => {
    try {
      const limit = readLimit(req.query.limit);
      const rows = await activity.listActor({
        actorId: req.user.id,
        hospitalId: req.user.hospital_id,
        before: readCursor(req.query.before),
        limit: limit + 1,
        filter: readFilter(req.query.filter)
      });
      res.json(respond(rows, limit, "staff"));
    } catch (error) { next(error); }
  });

  app.get("/admin/activity", admin, async (req, res, next) => {
    try {
      const limit = readLimit(req.query.limit);
      const rows = await activity.listHospital({
        hospitalId: req.user.hospital_id,
        before: readCursor(req.query.before),
        limit: limit + 1,
        filter: readFilter(req.query.filter)
      });
      res.json(respond(rows, limit, "staff"));
    } catch (error) { next(error); }
  });

  app.post("/auth/session-end", async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) return res.status(401).json({ error: "Authentication required" });
      let claims;
      try {
        claims = jwt.verify(token, config.jwtSecret, { ignoreExpiration: true });
      } catch {
        return res.status(401).json({ error: "Authentication required" });
      }
      const expired = Number(claims.exp) * 1000 <= Date.now();
      if (claims.aud === PATIENT_AUDIENCE || claims.role === "patient") {
        const patientRow = await db.getPatientForAuth(claims.sub);
        if (!patientRow || patientRow.hospital_id !== claims.hospitalId) return res.status(401).json({ error: "Authentication required" });
        await recordActivity(db, {
          actorRole: "patient",
          actorLabel: patientRow.patientId,
          hospitalId: patientRow.hospital_id,
          patientId: patientRow.id,
          publicPatientId: patientRow.patientId,
          action: expired ? "SESSION_EXPIRED" : "LOGOUT",
          category: "login",
          outcome: "success"
        });
        return res.json({ status: expired ? "expired" : "signed_out" });
      }
      const user = await db.getUserForAuth(claims.sub);
      if (!user || user.hospital_id !== claims.hospitalId) return res.status(401).json({ error: "Authentication required" });
      const tokenVersion = Number.isInteger(claims.tv) ? claims.tv : 0;
      const currentVersion = Number.isInteger(user.token_version) ? user.token_version : 0;
      if (tokenVersion !== currentVersion) return res.json({ status: "revoked" });
      await recordActivity(db, {
        actorId: user.id,
        actorRole: user.role,
        hospitalId: user.hospital_id,
        action: expired ? "SESSION_EXPIRED" : "LOGOUT",
        category: "login",
        outcome: "success"
      });
      res.json({ status: expired ? "expired" : "signed_out" });
    } catch (error) { next(error); }
  });
}

module.exports = {
  CLINICAL_ACTIONS,
  VIEW_WINDOW_MS,
  registerActivityAudit,
  recordActivity,
  createMemoryActivityStore,
  repeatedView,
  presentActivity,
  formatIst,
  describeActivity,
  matchesFilter,
  safeMetadata,
  categoryFor,
  createPgActivityStore
};
