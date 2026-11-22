const crypto = require("node:crypto");
const express = require("express");
const { encryptJson, decryptJson, requiredKey } = require("./crypto");
const { requireAuth, requirePatient } = require("./auth");
const { recordActivity } = require("./activityAudit");
const { CONSENT_REQUIRED, WALLET_REQUIRED } = require("./consentChain");
const {
  MAX_FILE_BYTES,
  CATEGORIES,
  fileEncryptionKey,
  encryptBytes,
  decryptBytes,
  detectFile,
  safeFilename,
  extensionMatches,
  safeDescription,
  storageKey,
  validStorageKey,
  contentDisposition
} = require("./medicalFileBytes");

const TYPE_REJECTED = "This file type is not accepted. Use a PDF, JPG, or PNG.";
const SIZE_REJECTED = "This file is larger than 10 MB.";
const STORAGE_UNAVAILABLE = "Medical file storage is not configured.";
const FILE_MISSING = "File not found";
const ALLOWED_DENIAL = new Set([CONSENT_REQUIRED, WALLET_REQUIRED]);

function registerMedicalFiles(app, { db, blockchain, config, fileStore, maxBytes = MAX_FILE_BYTES }) {
  const key = () => fileEncryptionKey(requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32));
  const textKey = () => requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);
  const patient = requirePatient(config.jwtSecret, { loadPatient: db.getPatientForAuth });
  const doctor = requireAuth(config.jwtSecret, ["doctor"], { loadUser: db.getUserForAuth });
  const upload = express.raw({ type: "application/octet-stream", limit: maxBytes });

  app.get("/patient-portal/files", patient, async (req, res, next) => {
    try {
      res.json({ files: await listFiles(db, textKey(), req.patient.id, req.patient.hospital_id) });
    } catch (error) { next(error); }
  });

  app.post("/patient-portal/files", patient, upload, async (req, res, next) => {
    try {
      await saveFile(req, res, {
        db,
        fileStore,
        maxBytes,
        fileKey: key(),
        textKey: textKey(),
        patient: req.patient,
        actorId: null,
        actorRole: "patient",
        actorLabel: req.patient.patientId,
        uploaderUserId: null
      });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/files/:fileId/content", patient, async (req, res, next) => {
    try {
      await sendFile(req, res, {
        db,
        fileStore,
        fileKey: key(),
        textKey: textKey(),
        patient: req.patient,
        actorId: null,
        actorRole: "patient",
        actorLabel: req.patient.patientId
      });
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId/files", doctor, authorizeDoctor(false), async (req, res, next) => {
    try {
      res.json({ files: await listFiles(db, textKey(), req.medicalPatient.id, req.medicalPatient.hospital_id) });
    } catch (error) { next(error); }
  });

  app.post("/patients/:patientId/files", doctor, authorizeDoctor(true), upload, async (req, res, next) => {
    try {
      const label = typeof db.getStaffName === "function" ? await db.getStaffName(req.user.id) : null;
      await saveFile(req, res, {
        db,
        fileStore,
        maxBytes,
        fileKey: key(),
        textKey: textKey(),
        patient: req.medicalPatient,
        actorId: req.user.id,
        actorRole: "doctor",
        actorLabel: label || "Doctor",
        uploaderUserId: req.user.id
      });
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId/files/:fileId/content", doctor, authorizeDoctor(false), async (req, res, next) => {
    try {
      const label = typeof db.getStaffName === "function" ? await db.getStaffName(req.user.id) : null;
      await sendFile(req, res, {
        db,
        fileStore,
        fileKey: key(),
        textKey: textKey(),
        patient: req.medicalPatient,
        actorId: req.user.id,
        actorRole: "doctor",
        actorLabel: label || "Doctor"
      });
    } catch (error) { next(error); }
  });

  function authorizeDoctor(uploadOnly) {
    return async (req, res, next) => {
      try {
        if (typeof db.getPatientChartSource !== "function") return res.status(503).json({ error: "Service unavailable" });
        const row = await db.getPatientChartSource(req.params.patientId, req.user.hospital_id);
        if (!row) return res.status(404).json({ error: "Patient not found" });
        const { openClinicalAccess } = require("./clinicalRecords");
        let mode;
        try {
          mode = await openClinicalAccess({ db, blockchain, userId: req.user.sub, patient: row });
        } catch (error) {
          if (error?.statusCode === 403) {
            await auditFile(db, req.user, row, "FILE_ACCESS_DENIED", null, "denied");
            return res.status(403).json({ error: ALLOWED_DENIAL.has(error.message) ? error.message : CONSENT_REQUIRED });
          }
          throw error;
        }
        if (uploadOnly && mode !== "consent") {
          await auditFile(db, req.user, row, "FILE_ACCESS_DENIED", null, "denied");
          return res.status(403).json({ error: CONSENT_REQUIRED });
        }
        req.medicalPatient = row;
        next();
      } catch (error) { next(error); }
    };
  }
}

async function listFiles(db, key, patientId, hospitalId) {
  if (typeof db.listMedicalFiles !== "function") return [];
  const rows = await db.listMedicalFiles(patientId, hospitalId);
  return rows.map((row) => presentFile(row, key));
}

async function saveFile(req, res, context) {
  if (!context.fileStore?.configured) return res.status(503).json({ error: STORAGE_UNAVAILABLE });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: TYPE_REJECTED });
  const detected = detectFile(req.body, context.maxBytes);
  if (detected.error === "size") return res.status(400).json({ error: SIZE_REJECTED });
  if (!detected.contentType) return res.status(400).json({ error: TYPE_REJECTED });
  const filename = safeFilename(req.get("x-medchain-filename"));
  const description = safeDescription(req.get("x-medchain-description"));
  const category = String(req.get("x-medchain-category") || "");
  if (!filename || !extensionMatches(filename, detected.contentType)) return res.status(400).json({ error: TYPE_REJECTED });
  if (description == null) return res.status(400).json({ error: "Invalid request" });
  if (!CATEGORIES.has(category)) return res.status(400).json({ error: "Enter a file category." });
  const objectKey = storageKey();
  const envelope = encryptBytes(req.body, context.fileKey);
  await context.fileStore.put(objectKey, envelope);
  let saved;
  try {
    saved = await context.db.createMedicalFile({
      hospitalId: context.patient.hospital_id,
      patientId: context.patient.id,
      uploaderUserId: context.uploaderUserId,
      uploaderRole: context.actorRole,
      uploaderLabel: context.actorLabel,
      category,
      filenameCiphertext: encryptJson({ name: filename }, context.textKey),
      descriptionCiphertext: description ? encryptJson({ text: description }, context.textKey) : null,
      storageKey: objectKey,
      contentType: detected.contentType,
      byteSize: req.body.length,
      sha256: crypto.createHash("sha256").update(req.body).digest("hex")
    });
  } catch (error) {
    await context.fileStore.delete(objectKey).catch(() => {});
    throw error;
  }
  await auditFile(context.db, {
    id: context.actorId,
    role: context.actorRole,
    hospital_id: context.patient.hospital_id
  }, context.patient, "FILE_UPLOADED", saved.id, "success", { category, byteSize: req.body.length }, context.actorLabel);
  res.status(201).json(presentFile({
    ...saved,
    category,
    filenameCiphertext: encryptJson({ name: filename }, context.textKey),
    descriptionCiphertext: description ? encryptJson({ text: description }, context.textKey) : null,
    contentType: detected.contentType,
    byteSize: req.body.length,
    uploaderRole: context.actorRole,
    uploaderLabel: context.actorLabel
  }, context.textKey));
}

async function sendFile(req, res, context) {
  if (!context.fileStore?.configured) return res.status(503).json({ error: STORAGE_UNAVAILABLE });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.fileId || "")) {
    return res.status(404).json({ error: FILE_MISSING });
  }
  if (typeof context.db.getMedicalFile !== "function") return res.status(404).json({ error: FILE_MISSING });
  const row = await context.db.getMedicalFile(req.params.fileId, context.patient.id, context.patient.hospital_id);
  if (!row || !validStorageKey(row.storageKey)) return res.status(404).json({ error: FILE_MISSING });
  const envelope = await context.fileStore.get(row.storageKey);
  const plain = decryptBytes(envelope, context.fileKey);
  const digest = crypto.createHash("sha256").update(plain).digest("hex");
  const detected = detectFile(plain);
  if (digest !== row.sha256 || detected.contentType !== row.contentType) {
    throw Object.assign(new Error("Stored medical file could not be read"), { statusCode: 500 });
  }
  const intent = req.query.intent === "preview" ? "preview" : "download";
  const filename = textField(row.filenameCiphertext, context.textKey, "name") || "medical-file";
  await auditFile(context.db, {
    id: context.actorId,
    role: context.actorRole,
    hospital_id: context.patient.hospital_id
  }, context.patient, intent === "preview" ? "FILE_VIEWED" : "FILE_DOWNLOADED", row.id, "success", {
    category: row.category,
    byteSize: row.byteSize
  }, context.actorLabel);
  res.setHeader("Content-Type", row.contentType);
  res.setHeader("Content-Disposition", contentDisposition(intent, filename));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.send(plain);
}

function presentFile(row, key) {
  return {
    id: row.id,
    category: row.category,
    filename: textField(row.filenameCiphertext, key, "name") || "Medical file",
    description: textField(row.descriptionCiphertext, key, "text") || "",
    contentType: row.contentType,
    byteSize: row.byteSize,
    uploaderRole: row.uploaderRole,
    uploaderLabel: row.uploaderLabel,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null
  };
}

function textField(ciphertext, key, name) {
  if (!ciphertext) return "";
  try {
    const value = decryptJson(ciphertext, key);
    return typeof value?.[name] === "string" ? value[name] : "";
  } catch {
    return "";
  }
}

async function auditFile(db, actor, patient, action, resourceId, outcome, metadata = {}, label) {
  await recordActivity(db, {
    actorId: actor?.id || null,
    actorRole: actor?.role || null,
    actorLabel: label || null,
    hospitalId: patient?.hospital_id || actor?.hospital_id || null,
    patientId: patient?.id || null,
    publicPatientId: patient?.patientId || null,
    action,
    category: action === "FILE_ACCESS_DENIED" ? "security" : action === "FILE_UPLOADED" ? "changes" : "records",
    outcome,
    resourceId,
    metadata
  }).catch(() => {});
}

module.exports = {
  registerMedicalFiles,
  TYPE_REJECTED,
  SIZE_REJECTED,
  STORAGE_UNAVAILABLE
};
