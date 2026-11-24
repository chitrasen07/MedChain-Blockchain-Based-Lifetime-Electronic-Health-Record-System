const crypto = require("node:crypto");
const express = require("express");
const { z } = require("zod");
const { requireAuth, requirePatient } = require("./auth");
const { recordActivity } = require("./activityAudit");

const PHOTO_LIMIT = 2 * 1024 * 1024;
const PHOTO_REJECTED = "Profile photos must be a JPEG, PNG, or WebP image under 2 MB.";
const PHOTO_UNAVAILABLE = "Profile photo storage is not configured.";
const PROFILE_INVALID = "Check the professional profile and try again.";
const PROFILE_MISSING = "Doctor profile not found.";
const PROFILE_REVIEW = "This profile is not waiting for credential review.";

const qualificationSchema = z.object({
  degree: z.string().trim().min(2).max(40),
  institution: z.string().trim().min(2).max(200),
  graduationYear: z.number().int().min(1950).max(new Date().getUTCFullYear()).nullable().optional(),
  extra: z.string().trim().max(200).optional()
});

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(200).optional(),
  biography: z.string().trim().max(2000).optional(),
  specialization: z.string().trim().max(120).optional(),
  registrationNumber: z.string().trim().max(80).optional(),
  registrationCouncil: z.string().trim().max(160).optional(),
  experienceYears: z.number().int().min(0).max(80).nullable().optional(),
  department: z.string().trim().max(120).optional(),
  designation: z.string().trim().max(120).optional(),
  languages: z.string().trim().max(200).optional(),
  consultationHours: z.string().trim().max(300).optional(),
  qualifications: z.array(qualificationSchema).max(8).optional()
});

function fail(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function blank(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function asInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : null;
}

function credentialsOf(profile) {
  return {
    specialization: profile?.specialization || "",
    registrationNumber: profile?.registrationNumber || "",
    registrationCouncil: profile?.registrationCouncil || "",
    experienceYears: asInt(profile?.experienceYears),
    designation: profile?.designation || "",
    qualifications: (profile?.qualifications || []).map((item) => [item.degree, item.institution, asInt(item.graduationYear)])
  };
}

function ready(profile) {
  return Boolean(
    profile.specialization
    && profile.registrationNumber
    && Number.isInteger(asInt(profile.experienceYears))
    && profile.qualifications.some((item) => item.degree && item.institution)
  );
}

function nextStatus(previous, profile) {
  if (!ready(profile)) return "incomplete";
  const sameCredentials = JSON.stringify(credentialsOf(previous)) === JSON.stringify(credentialsOf(profile));
  if (previous?.status === "verified" && sameCredentials) return "verified";
  return "pending";
}

function parseProfile(body) {
  const parsed = profileSchema.safeParse(body || {});
  if (!parsed.success) throw fail(PROFILE_INVALID, 400);
  const input = parsed.data;
  return {
    fullName: blank(input.fullName),
    biography: blank(input.biography),
    specialization: blank(input.specialization),
    registrationNumber: blank(input.registrationNumber),
    registrationCouncil: blank(input.registrationCouncil),
    experienceYears: Number.isInteger(input.experienceYears) ? input.experienceYears : null,
    department: blank(input.department),
    designation: blank(input.designation),
    languages: blank(input.languages),
    consultationHours: blank(input.consultationHours),
    qualifications: (input.qualifications || []).map((item) => ({
      degree: item.degree.trim(),
      institution: item.institution.trim(),
      graduationYear: Number.isInteger(item.graduationYear) ? item.graduationYear : null,
      extra: blank(item.extra)
    }))
  };
}

function detectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > PHOTO_LIMIT) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

function present(profile, { includeReview = false, includeRegistration = true } = {}) {
  if (!profile) return null;
  const qualifications = (profile.qualifications || []).map((item) => ({
    ...item,
    graduationYear: asInt(item.graduationYear)
  }));
  const view = {
    id: profile.id,
    fullName: profile.fullName || null,
    hospitalName: profile.hospitalName || null,
    biography: profile.biography || null,
    specialization: profile.specialization || null,
    experienceYears: asInt(profile.experienceYears),
    department: profile.department || null,
    designation: profile.designation || null,
    languages: profile.languages || null,
    consultationHours: profile.consultationHours || null,
    qualifications,
    verificationStatus: profile.status || "incomplete",
    photoAvailable: Boolean(profile.photoKey),
    degrees: qualifications.map((item) => item.degree).filter(Boolean).join(", ")
  };
  if (includeRegistration) {
    view.registrationNumber = profile.registrationNumber || null;
    view.registrationCouncil = profile.registrationCouncil || null;
  }
  if (includeReview) view.reviewNote = profile.reviewNote || null;
  return view;
}

function createPgProfileStore(db) {
  const selectProfile = `
    SELECT u.id, u.full_name AS "fullName", u.hospital_id AS "hospitalId", h.name AS "hospitalName",
      p.biography, p.specialization, p.registration_number AS "registrationNumber",
      p.registration_council AS "registrationCouncil", p.experience_years AS "experienceYears",
      p.department, p.designation, p.languages, p.consultation_hours AS "consultationHours",
      p.photo_key AS "photoKey", p.photo_content_type AS "photoContentType",
      COALESCE(p.status, 'incomplete') AS status, p.review_note AS "reviewNote"
    FROM users u
    JOIN hospitals h ON h.id = u.hospital_id
    LEFT JOIN doctor_profiles p ON p.user_id = u.id
    WHERE u.id = $1 AND u.hospital_id = $2 AND u.role = 'doctor'`;

  async function qualifications(userId) {
    const result = await db.query(
      `SELECT degree, institution, graduation_year AS "graduationYear", extra
       FROM doctor_qualifications WHERE user_id = $1 ORDER BY position, id`,
      [userId]
    );
    return result.rows;
  }

  async function load(userId, hospitalId) {
    const result = await db.query(selectProfile, [userId, hospitalId]);
    const row = result.rows[0];
    if (!row) return null;
    row.qualifications = await qualifications(userId);
    return row;
  }

  return {
    async getOwn(userId, hospitalId) { return load(userId, hospitalId); },
    async saveOwn(userId, hospitalId, input) {
      return db.transaction(async (client) => {
        const current = await client.query(`${selectProfile} FOR UPDATE OF u`, [userId, hospitalId]);
        const row = current.rows[0];
        if (!row) return null;
        const existingQualifications = (await client.query(
          `SELECT degree, institution, graduation_year AS "graduationYear" FROM doctor_qualifications WHERE user_id = $1 ORDER BY position`,
          [userId]
        )).rows;
        const previous = { ...row, qualifications: existingQualifications };
        const status = nextStatus(previous, input);
        if (input.fullName) {
          await client.query("UPDATE users SET full_name = $3 WHERE id = $1 AND hospital_id = $2 AND role = 'doctor'", [userId, hospitalId, input.fullName]);
        }
        await client.query(
          `INSERT INTO doctor_profiles (
             user_id, hospital_id, biography, specialization, registration_number, registration_council,
             experience_years, department, designation, languages, consultation_hours, status, review_note, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,now())
           ON CONFLICT (user_id) DO UPDATE SET
             biography = EXCLUDED.biography, specialization = EXCLUDED.specialization,
             registration_number = EXCLUDED.registration_number, registration_council = EXCLUDED.registration_council,
             experience_years = EXCLUDED.experience_years, department = EXCLUDED.department,
             designation = EXCLUDED.designation, languages = EXCLUDED.languages,
             consultation_hours = EXCLUDED.consultation_hours, status = EXCLUDED.status,
             review_note = NULL, updated_at = now()`,
          [
            userId, hospitalId, input.biography, input.specialization, input.registrationNumber, input.registrationCouncil,
            input.experienceYears, input.department, input.designation, input.languages, input.consultationHours, status
          ]
        );
        await client.query("DELETE FROM doctor_qualifications WHERE user_id = $1", [userId]);
        for (let index = 0; index < input.qualifications.length; index += 1) {
          const item = input.qualifications[index];
          await client.query(
            `INSERT INTO doctor_qualifications (user_id, degree, institution, graduation_year, extra, position) VALUES ($1,$2,$3,$4,$5,$6)`,
            [userId, item.degree, item.institution, item.graduationYear, item.extra, index]
          );
        }
        const saved = (await client.query(selectProfile, [userId, hospitalId])).rows[0];
        saved.qualifications = input.qualifications;
        return saved;
      });
    },
    async setPhoto(userId, hospitalId, photo) {
      const owner = await db.query("SELECT id FROM users WHERE id = $1 AND hospital_id = $2 AND role = 'doctor'", [userId, hospitalId]);
      if (!owner.rowCount) return null;
      await db.query(
        `INSERT INTO doctor_profiles (user_id, hospital_id, photo_key, photo_content_type)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET photo_key = EXCLUDED.photo_key, photo_content_type = EXCLUDED.photo_content_type, updated_at = now()`,
        [userId, hospitalId, photo.key, photo.contentType]
      );
      return { key: photo.key, contentType: photo.contentType };
    },
    async getPhoto(userId, hospitalId) {
      const result = await db.query(
        `SELECT p.photo_key AS "photoKey", p.photo_content_type AS "photoContentType"
         FROM doctor_profiles p JOIN users u ON u.id = p.user_id
         WHERE p.user_id = $1 AND u.hospital_id = $2 AND u.role = 'doctor' AND p.photo_key IS NOT NULL`,
        [userId, hospitalId]
      );
      return result.rows[0] || null;
    },
    async review(doctorId, hospitalId, reviewerId, decision, note) {
      const result = await db.query(
        `UPDATE doctor_profiles SET status = $3, review_note = $4, reviewed_by = $5, reviewed_at = now(), updated_at = now()
         WHERE user_id = $1 AND hospital_id = $2 AND status = 'pending'
         RETURNING user_id`,
        [doctorId, hospitalId, decision, note, reviewerId]
      );
      if (!result.rowCount) return null;
      return load(doctorId, hospitalId);
    },
    async isBookable(doctorId, hospitalId) {
      const result = await db.query(
        `SELECT 1 FROM users u JOIN staff_chain_authorizations s ON s.user_id = u.id
         WHERE u.id = $1 AND u.hospital_id = $2 AND u.role = 'doctor' AND u.status = 'active'
           AND s.status = 'active' AND s.action = 'grant' AND s.chain_role = 'DOCTOR' AND s.wallet_address IS NOT NULL`,
        [doctorId, hospitalId]
      );
      return result.rowCount > 0;
    }
  };
}

function createMemoryProfileStore() {
  const doctors = new Map();
  return {
    doctors,
    seed(doctor) { doctors.set(doctor.id, { qualifications: [], status: "incomplete", ...doctor }); },
    async getOwn(userId, hospitalId) {
      const doctor = doctors.get(userId);
      return doctor && doctor.hospitalId === hospitalId ? doctor : null;
    },
    async saveOwn(userId, hospitalId, input) {
      const doctor = doctors.get(userId);
      if (!doctor || doctor.hospitalId !== hospitalId) return null;
      const status = nextStatus(doctor, input);
      Object.assign(doctor, input, { status, reviewNote: null, fullName: input.fullName || doctor.fullName });
      return doctor;
    },
    async setPhoto(userId, hospitalId, photo) {
      const doctor = doctors.get(userId);
      if (!doctor || doctor.hospitalId !== hospitalId) return null;
      doctor.photoKey = photo.key;
      doctor.photoContentType = photo.contentType;
      return photo;
    },
    async getPhoto(userId, hospitalId) {
      const doctor = doctors.get(userId);
      if (!doctor || doctor.hospitalId !== hospitalId || !doctor.photoKey) return null;
      return { photoKey: doctor.photoKey, photoContentType: doctor.photoContentType };
    },
    async review(doctorId, hospitalId, reviewerId, decision, note) {
      const doctor = doctors.get(doctorId);
      if (!doctor || doctor.hospitalId !== hospitalId || doctor.status !== "pending") return null;
      doctor.status = decision;
      doctor.reviewNote = note;
      doctor.reviewedBy = reviewerId;
      return doctor;
    },
    async isBookable(doctorId, hospitalId) {
      const doctor = doctors.get(doctorId);
      return Boolean(doctor && doctor.hospitalId === hospitalId && doctor.bookable);
    }
  };
}

function registerDoctorProfiles(app, { db, config, fileStore, store } = {}) {
  const profiles = store || createPgProfileStore(db);
  const files = fileStore || { configured: false };
  const doctor = requireAuth(config.jwtSecret, ["doctor"], { loadUser: (id) => db.getUserForAuth(id) });
  const admin = requireAuth(config.jwtSecret, ["administrator"], { loadUser: (id) => db.getUserForAuth(id) });
  const patient = requirePatient(config.jwtSecret, { loadPatient: (id) => db.getPatientForAuth(id) });
  const upload = express.raw({ type: "application/octet-stream", limit: PHOTO_LIMIT });

  async function audit(req, action, doctorId, outcome = "success") {
    await recordActivity(db, {
      actorId: req.user?.id || req.patient?.id || null,
      actorRole: req.user?.role || "patient",
      hospitalId: req.user?.hospital_id || req.patient?.hospital_id,
      action,
      category: "profile",
      outcome,
      resourceId: doctorId,
      metadata: {}
    }).catch(() => {});
  }

  async function sendPhoto(res, hospitalId, doctorId) {
    const photo = await profiles.getPhoto(doctorId, hospitalId);
    if (!photo?.photoKey) return res.status(404).json({ error: PROFILE_MISSING });
    if (!files.configured) return res.status(503).json({ error: PHOTO_UNAVAILABLE });
    const body = await files.get(photo.photoKey);
    res.set("Content-Type", photo.photoContentType || "application/octet-stream");
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.send(body);
  }

  app.get("/doctor/profile", doctor, async (req, res, next) => {
    try {
      const profile = await profiles.getOwn(req.user.id, req.user.hospital_id);
      if (!profile) return res.status(404).json({ error: PROFILE_MISSING });
      res.json(present(profile, { includeReview: true }));
    } catch (error) { next(error); }
  });

  app.put("/doctor/profile", doctor, async (req, res, next) => {
    try {
      const input = parseProfile(req.body);
      const saved = await profiles.saveOwn(req.user.id, req.user.hospital_id, input);
      if (!saved) return res.status(404).json({ error: PROFILE_MISSING });
      await audit(req, saved.status === "pending" ? "PROFILE_SUBMITTED" : "PROFILE_UPDATED", req.user.id);
      res.json(present(saved, { includeReview: true }));
    } catch (error) { next(error); }
  });

  app.post("/doctor/profile/photo", doctor, upload, async (req, res, next) => {
    try {
      const contentType = detectImage(req.body);
      if (!contentType) return res.status(400).json({ error: PHOTO_REJECTED });
      if (!files.configured) return res.status(503).json({ error: PHOTO_UNAVAILABLE });
      const key = `profile/v1/${crypto.randomUUID()}`;
      await files.put(key, req.body);
      const saved = await profiles.setPhoto(req.user.id, req.user.hospital_id, { key, contentType });
      if (!saved) return res.status(404).json({ error: PROFILE_MISSING });
      await audit(req, "PROFILE_UPDATED", req.user.id);
      res.json({ photoAvailable: true });
    } catch (error) { next(error); }
  });

  app.get("/doctor/profile/photo", doctor, async (req, res, next) => {
    try { await sendPhoto(res, req.user.hospital_id, req.user.id); } catch (error) { next(error); }
  });

  app.get("/admin/doctors/:id/profile", admin, async (req, res, next) => {
    try {
      const profile = await profiles.getOwn(req.params.id, req.user.hospital_id);
      if (!profile) return res.status(404).json({ error: PROFILE_MISSING });
      res.json(present(profile, { includeReview: true }));
    } catch (error) { next(error); }
  });

  app.post("/admin/doctors/:id/profile/review", admin, async (req, res, next) => {
    try {
      if (req.params.id === req.user.id) return res.status(403).json({ error: "This account cannot perform that action." });
      const decision = req.body?.decision === "verified" ? "verified" : req.body?.decision === "changes_requested" ? "changes_requested" : "";
      if (!decision) return res.status(400).json({ error: PROFILE_INVALID });
      const note = blank(req.body?.note);
      if (note && note.length > 500) return res.status(400).json({ error: PROFILE_INVALID });
      const saved = await profiles.review(req.params.id, req.user.hospital_id, req.user.id, decision, note);
      if (!saved) return res.status(409).json({ error: PROFILE_REVIEW });
      await audit(req, decision === "verified" ? "PROFILE_APPROVED" : "PROFILE_CHANGES_REQUESTED", req.params.id);
      res.json(present(saved, { includeReview: true }));
    } catch (error) { next(error); }
  });

  app.get("/admin/doctors/:id/profile/photo", admin, async (req, res, next) => {
    try { await sendPhoto(res, req.user.hospital_id, req.params.id); } catch (error) { next(error); }
  });

  app.get("/patient-portal/doctors/:id", patient, async (req, res, next) => {
    try {
      if (!(await profiles.isBookable(req.params.id, req.patient.hospital_id))) return res.status(404).json({ error: PROFILE_MISSING });
      const profile = await profiles.getOwn(req.params.id, req.patient.hospital_id);
      if (!profile) return res.status(404).json({ error: PROFILE_MISSING });
      res.json(present(profile, { includeRegistration: false }));
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/doctors/:id/photo", patient, async (req, res, next) => {
    try {
      if (!(await profiles.isBookable(req.params.id, req.patient.hospital_id))) return res.status(404).json({ error: PROFILE_MISSING });
      await sendPhoto(res, req.patient.hospital_id, req.params.id);
    } catch (error) { next(error); }
  });
}

module.exports = {
  PHOTO_LIMIT,
  PHOTO_REJECTED,
  PHOTO_UNAVAILABLE,
  PROFILE_INVALID,
  PROFILE_MISSING,
  PROFILE_REVIEW,
  createMemoryProfileStore,
  createPgProfileStore,
  detectImage,
  nextStatus,
  parseProfile,
  present,
  registerDoctorProfiles
};
