const crypto = require("node:crypto");
const { z } = require("zod");
const { decryptJson, encryptJson, requiredKey } = require("./crypto");
const { requireAuth } = require("./auth");
const { CONSENT_REQUIRED, EMERGENCY_LIMIT } = require("./consentChain");
const { noteClinicalAudit, openClinicalAccess, recordContentHash } = require("./clinicalRecords");
const { mergeProfile } = require("./chart");

const NURSE_ONLY = "Hospital staff record vitals, visit notes, and laboratory intake. A doctor reviews them before they become a clinical record.";
const DOCTOR_REVIEW = "Only a doctor can review nursing intake.";
const ALREADY_REVIEWED = "This intake has already been reviewed.";
const NOT_READY = "This report is not ready to anchor. No transaction was sent.";

const VITAL_UNITS = {
  bloodPressure: "mmHg",
  heartRate: "bpm",
  temperature: "C",
  spo2: "%",
  respiratoryRate: "breaths/min",
  height: "cm",
  weight: "kg"
};

function invalidRequest() {
  const error = new Error("Invalid request");
  error.statusCode = 400;
  return error;
}

function text(fields, name, max = 2000) {
  const value = typeof fields?.[name] === "string" ? fields[name].trim() : "";
  if (value.length > max) throw invalidRequest();
  return value;
}

function numberIn(value, min, max, decimals = false) {
  if (!(decimals ? /^\d+(\.\d+)?$/ : /^\d+$/).test(value)) throw invalidRequest();
  const number = Number(value);
  if (number < min || number > max) throw invalidRequest();
  return value;
}

function intakeContent(kind, recordedOn, fields) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedOn || "")) throw invalidRequest();
  const content = { kind, recordedOn };
  if (kind === "vital") {
    const measured = [];
    const bloodPressure = text(fields, "bloodPressure", 7);
    if (bloodPressure) {
      const match = /^(\d{2,3})\/(\d{2,3})$/.exec(bloodPressure);
      if (!match) throw invalidRequest();
      const systolic = Number(match[1]);
      const diastolic = Number(match[2]);
      if (systolic < 50 || systolic > 260 || diastolic < 20 || diastolic > 200 || systolic <= diastolic) throw invalidRequest();
      content.bloodPressure = bloodPressure;
      measured.push("bloodPressure");
    }
    const ranges = {
      heartRate: [20, 250, false],
      temperature: [30, 45, true],
      spo2: [50, 100, false],
      respiratoryRate: [4, 80, false],
      height: [30, 250, true],
      weight: [0.5, 400, true]
    };
    for (const [name, [min, max, decimals]] of Object.entries(ranges)) {
      const value = text(fields, name, 8);
      if (!value) continue;
      content[name] = numberIn(value, min, max, decimals);
      measured.push(name);
    }
    if (!measured.length) throw invalidRequest();
    for (const name of measured) {
      const unit = text(fields, `${name}Unit`, 20);
      content[`${name}Unit`] = unit || VITAL_UNITS[name];
    }
    const notes = text(fields, "notes");
    if (notes) content.notes = notes;
    return content;
  }
  if (kind === "visit_note") {
    const checkInAt = text(fields, "checkInAt", 40);
    const reason = text(fields, "reason", 500);
    const symptoms = text(fields, "symptoms");
    const observations = text(fields, "observations");
    const parsed = Date.parse(checkInAt);
    if (!reason || !Number.isFinite(parsed) || parsed > Date.now() + 5 * 60 * 1000) throw invalidRequest();
    content.checkInAt = new Date(parsed).toISOString();
    content.reason = reason;
    if (symptoms) content.symptoms = symptoms;
    if (observations) content.observations = observations;
    return content;
  }
  if (kind === "laboratory") {
    const testName = text(fields, "testName", 200);
    const result = text(fields, "result", 200);
    if (!testName || !result) throw invalidRequest();
    content.testName = testName;
    content.result = result;
    for (const name of ["unit", "referenceRange", "notes"]) {
      const value = text(fields, name, name === "notes" ? 2000 : 80);
      if (value) content[name] = value;
    }
    const collectedOn = text(fields, "collectedOn", 10);
    if (collectedOn) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(collectedOn)) throw invalidRequest();
      content.collectedOn = collectedOn;
    }
    return content;
  }
  throw invalidRequest();
}

function presentIntake(row, key, { includeContent }) {
  let content = null;
  if (includeContent && row.contentCiphertext) {
    try { content = decryptJson(row.contentCiphertext, key); } catch { content = null; }
  }
  return {
    id: row.id,
    patientId: row.patientId,
    kind: row.kind,
    status: row.status,
    label: row.status === "pending_review" ? "Pending doctor review" : row.status === "reviewed" ? "Reviewed" : "Rejected",
    contentHash: row.contentHash,
    authorName: row.authorName || null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
    promotedRecordId: row.promotedRecordId || null,
    content
  };
}

function promotedContent(kind, content) {
  if (kind === "vital") {
    const next = { category: "vital", recordedOn: content.recordedOn };
    for (const name of Object.keys(VITAL_UNITS)) {
      if (content[name]) {
        next[name] = content[name];
        next[`${name}Unit`] = content[`${name}Unit`] || VITAL_UNITS[name];
      }
    }
    if (content.notes) next.notes = content.notes;
    return next;
  }
  if (kind === "visit_note") {
    const notes = [
      content.symptoms ? `Symptoms: ${content.symptoms}` : "",
      content.observations ? `Observations: ${content.observations}` : ""
    ].filter(Boolean).join("\n");
    return {
      category: "visit",
      recordedOn: content.recordedOn,
      reason: content.reason,
      ...(notes ? { notes } : {}),
      ...(content.symptoms ? { symptoms: content.symptoms } : {}),
      ...(content.observations ? { observations: content.observations } : {}),
      checkInAt: content.checkInAt
    };
  }
  return {
    category: "laboratory",
    recordedOn: content.recordedOn,
    testName: content.testName,
    result: content.result,
    ...(content.unit ? { unit: content.unit } : {}),
    ...(content.referenceRange ? { referenceRange: content.referenceRange } : {}),
    ...(content.collectedOn ? { collectedOn: content.collectedOn } : {}),
    ...(content.notes ? { notes: content.notes } : {})
  };
}

function registerNursing(app, { db, blockchain, config }) {
  const nurse = requireAuth(config.jwtSecret, ["hospital_staff"], { loadUser: db.getUserForAuth });
  const reviewer = requireAuth(config.jwtSecret, ["doctor"], { loadUser: db.getUserForAuth });
  const queueRoles = requireAuth(config.jwtSecret, ["hospital_staff", "doctor"], { loadUser: db.getUserForAuth });
  const key = () => requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);

  app.post("/patients/:patientId/nursing-intake", nurse, async (req, res, next) => {
    try {
      const input = z.object({
        kind: z.enum(["vital", "visit_note", "laboratory"]),
        recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        fields: z.record(z.string(), z.string().max(2000))
      }).parse(req.body);
      if (input.recordedOn > new Date().toISOString().slice(0, 10)) throw invalidRequest();
      const content = intakeContent(input.kind, input.recordedOn, input.fields);
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const saved = await db.createNursingIntake({
        publicPatientId: patient.patientId,
        hospitalId: req.user.hospital_id,
        kind: input.kind,
        contentCiphertext: encryptJson(content, key()),
        contentHash: recordContentHash(content),
        actorId: req.user.sub
      });
      await noteClinicalAudit(db, {
        hospitalId: req.user.hospital_id,
        publicPatientId: patient.patientId,
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: "intake_created",
        category: input.kind
      });
      res.status(201).json({
        id: saved.id,
        patientId: patient.patientId,
        kind: saved.kind,
        status: "pending_review",
        label: "Pending doctor review",
        contentHash: saved.contentHash,
        content
      });
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId/nursing-intake", queueRoles, async (req, res, next) => {
    try {
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      let mode = "staff";
      if (req.user.role === "doctor") {
        mode = await openClinicalAccess({ db, blockchain, userId: req.user.sub, patient });
      }
      const rows = await db.listNursingIntake(patient.patientId, req.user.hospital_id);
      const visible = rows.filter((row) => mode !== "emergency" || row.kind === "laboratory");
      if (mode === "emergency" && !visible.length && rows.length) {
        return res.status(403).json({ error: EMERGENCY_LIMIT });
      }
      await noteClinicalAudit(db, {
        hospitalId: req.user.hospital_id,
        publicPatientId: patient.patientId,
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: "intake_viewed"
      });
      res.json({
        patientId: patient.patientId,
        access: mode,
        items: visible.map((row) => presentIntake(row, key(), { includeContent: true }))
      });
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId/staff-summary", nurse, async (req, res, next) => {
    try {
      if (typeof db.getPatientChartSource !== "function") {
        return res.status(503).json({ error: "Service unavailable" });
      }
      const patient = await db.getPatientChartSource(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      let profile = {};
      if (patient.piiCiphertext) {
        try { profile = decryptJson(patient.piiCiphertext, key()); } catch { profile = {}; }
      }
      let correctionRows = [];
      if (typeof db.listDemographicCorrections === "function") {
        try {
          correctionRows = await db.listDemographicCorrections(patient.patientId, req.user.hospital_id);
        } catch (error) {
          if (error?.code !== "42P01") throw error;
        }
      }
      const corrections = correctionRows.map((row) => {
        try { return decryptJson(row.contentCiphertext, key()); } catch { return {}; }
      });
      profile = mergeProfile(profile, [], corrections);
      const rows = await db.listNursingIntake(patient.patientId, req.user.hospital_id);
      const items = rows.map((row) => presentIntake(row, key(), { includeContent: true }));
      await noteClinicalAudit(db, {
        hospitalId: req.user.hospital_id,
        publicPatientId: patient.patientId,
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: "intake_viewed"
      });
      res.json({
        patientId: patient.patientId,
        status: patient.status,
        createdAt: patient.createdAt,
        demographics: {
          fullName: profile.fullName || null,
          dateOfBirth: profile.dateOfBirth || null,
          gender: profile.gender || null,
          bloodGroup: profile.bloodGroup || null
        },
        vitals: items.filter((item) => item.kind === "vital"),
        visits: items.filter((item) => item.kind === "visit_note"),
        labs: items.filter((item) => item.kind === "laboratory")
      });
    } catch (error) { next(error); }
  });

  app.get("/nursing/queue", queueRoles, async (req, res, next) => {
    try {
      const [recentPatients, pending] = await Promise.all([
        db.listRecentPatients(req.user.hospital_id),
        db.listNursingQueue(req.user.hospital_id)
      ]);
      const item = (row) => ({
        id: row.id,
        patientId: row.patientId,
        kind: row.kind,
        status: row.status,
        label: "Pending doctor review",
        createdAt: row.createdAt
      });
      res.json({
        recentPatients,
        pendingLabs: pending.filter((row) => row.kind === "laboratory").map(item),
        visitTasks: pending.filter((row) => row.kind === "visit_note").map(item),
        pendingVitals: pending.filter((row) => row.kind === "vital").map(item)
      });
    } catch (error) { next(error); }
  });

  app.post("/nursing-intake/:id/review", reviewer, async (req, res, next) => {
    try {
      const input = z.object({
        decision: z.enum(["approve", "reject"]),
        note: z.string().trim().max(500).optional()
      }).parse(req.body);
      const intake = await db.getNursingIntake(req.params.id, req.user.hospital_id);
      if (!intake) return res.status(404).json({ error: "Patient not found" });
      if (intake.status !== "pending_review") return res.status(409).json({ error: ALREADY_REVIEWED });
      const patient = await db.getPatient(intake.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const mode = await openClinicalAccess({ db, blockchain, userId: req.user.sub, patient });
      if (mode !== "consent") return res.status(403).json({ error: CONSENT_REQUIRED });
      const content = decryptJson(intake.contentCiphertext, key());
      if (recordContentHash(content) !== intake.contentHash) {
        return res.status(409).json({ error: NOT_READY });
      }
      let promoted = null;
      if (input.decision === "approve") {
        const clinical = promotedContent(intake.kind, content);
        promoted = await db.createMedicalRecord({
          publicPatientId: patient.patientId,
          hospitalId: req.user.hospital_id,
          category: clinical.category,
          versionIndex: 0,
          priorRecordId: null,
          recordRef: `0x${crypto.randomBytes(32).toString("hex")}`,
          contentCiphertext: encryptJson(clinical, key()),
          contentHash: recordContentHash(clinical),
          recordedOn: clinical.recordedOn,
          actorId: req.user.sub,
          correctionReasonCiphertext: null,
          workflowStatus: "reviewed"
        });
      }
      const saved = await db.reviewNursingIntake({
        id: intake.id,
        hospitalId: req.user.hospital_id,
        status: input.decision === "approve" ? "reviewed" : "rejected",
        reviewNoteCiphertext: input.note ? encryptJson({ note: input.note }, key()) : null,
        reviewerId: req.user.sub,
        promotedRecordId: promoted?.id || null
      });
      if (!saved) return res.status(409).json({ error: ALREADY_REVIEWED });
      await noteClinicalAudit(db, {
        hospitalId: req.user.hospital_id,
        publicPatientId: patient.patientId,
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: input.decision === "approve" ? "intake_reviewed" : "intake_rejected",
        category: intake.kind,
        versionIndex: promoted ? 0 : null
      });
      if (promoted) {
        await noteClinicalAudit(db, {
          hospitalId: req.user.hospital_id,
          publicPatientId: patient.patientId,
          actorId: req.user.sub,
          actorRole: req.user.role,
          action: "record_created",
          category: promoted.category,
          versionIndex: 0
        });
      }
      res.json({
        id: intake.id,
        status: saved.status,
        label: saved.status === "reviewed" ? "Reviewed" : "Rejected",
        promotedRecordId: saved.promotedRecordId,
        chainStatus: promoted?.chainStatus || null
      });
    } catch (error) { next(error); }
  });
}

module.exports = {
  registerNursing,
  intakeContent,
  promotedContent,
  NURSE_ONLY,
  DOCTOR_REVIEW,
  ALREADY_REVIEWED
};
