const crypto = require("node:crypto");
const { keccak256, toUtf8Bytes } = require("ethers");
const { z } = require("zod");
const { decryptJson, encryptJson, requiredKey } = require("./crypto");
const { requireAuth } = require("./auth");

const CATEGORIES = {
  diagnosis: { condition: true, notes: false },
  prescription: { medication: true, dose: true, directions: false },
  laboratory: { testName: true, result: true, unit: false },
  allergy: { substance: true, reaction: false },
  treatment: { treatment: true, outcome: false },
  visit: { reason: true, notes: false }
};

const ANCHOR_REFUSAL = "The hospital wallet cannot anchor a medical record. Patient consent is required.";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function recordContentHash(content) {
  return keccak256(toUtf8Bytes(stableStringify(content)));
}

function clinicalContent(category, recordedOn, fields) {
  const spec = CATEGORIES[category];
  if (!spec) {
    const error = new Error("Invalid request");
    error.statusCode = 400;
    throw error;
  }
  const content = { category, recordedOn };
  for (const [name, required] of Object.entries(spec)) {
    const value = typeof fields?.[name] === "string" ? fields[name].trim() : "";
    if (value.length > 2000) {
      const error = new Error("Invalid request");
      error.statusCode = 400;
      throw error;
    }
    if (!value && required) {
      const error = new Error("Invalid request");
      error.statusCode = 400;
      throw error;
    }
    if (value) content[name] = value;
  }
  return content;
}

function recordedOnValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function presentClinicalRecord(row, key) {
  let content = {};
  if (row.contentCiphertext) content = decryptJson(row.contentCiphertext, key);
  return {
    id: row.id,
    category: row.category,
    recordedOn: recordedOnValue(row.recordedOn),
    versionIndex: row.versionIndex,
    recordRef: row.recordRef,
    contentHash: row.contentHash,
    chainStatus: row.chainStatus || "consent_required",
    transaction: row.txHash || null,
    priorRecordId: row.priorRecordId || null,
    content
  };
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function registerClinicalRecords(app, { db, config }) {
  const clinical = requireAuth(
    config.jwtSecret,
    ["doctor", "hospital_staff"],
    { loadUser: db.getUserForAuth }
  );
  const key = () => requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);

  app.post("/patients/:patientId/records", clinical, async (req, res, next) => {
    try {
      const input = z.object({
        category: z.enum(["diagnosis", "prescription", "laboratory", "allergy", "treatment", "visit"]),
        recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        fields: z.record(z.string(), z.string().max(2000)),
        priorRecordId: z.string().uuid().optional()
      }).parse(req.body);
      if (input.recordedOn > todayUtc()) {
        return res.status(400).json({ error: "Invalid request" });
      }
      const content = clinicalContent(input.category, input.recordedOn, input.fields);
      const contentHash = recordContentHash(content);
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      let recordRef = `0x${crypto.randomBytes(32).toString("hex")}`;
      let versionIndex = 0;
      let priorRecordId = null;
      if (input.priorRecordId) {
        const prior = await db.getMedicalRecord(input.priorRecordId, req.user.hospital_id);
        if (!prior || prior.publicPatientId !== patient.patientId) {
          return res.status(404).json({ error: "Patient not found" });
        }
        recordRef = prior.recordRef;
        versionIndex = prior.versionIndex + 1;
        priorRecordId = prior.id;
      }
      const saved = await db.createMedicalRecord({
        publicPatientId: patient.patientId,
        hospitalId: req.user.hospital_id,
        category: input.category,
        versionIndex,
        priorRecordId,
        recordRef,
        contentCiphertext: encryptJson(content, key()),
        contentHash,
        recordedOn: input.recordedOn,
        actorId: req.user.sub
      });
      res.status(201).json({
        id: saved.id,
        category: saved.category,
        recordedOn: recordedOnValue(saved.recordedOn),
        versionIndex: saved.versionIndex,
        recordRef: saved.recordRef,
        contentHash: saved.contentHash,
        chainStatus: saved.chainStatus,
        transaction: null,
        priorRecordId: saved.priorRecordId,
        content,
        anchoring: "disabled"
      });
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId/records", clinical, async (req, res, next) => {
    try {
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const rows = await db.listMedicalRecordsByPublicId(patient.patientId, req.user.hospital_id);
      res.json({
        patientId: patient.patientId,
        records: rows.map((row) => presentClinicalRecord(row, key())),
        anchoring: "disabled"
      });
    } catch (error) { next(error); }
  });

  app.post("/patients/:patientId/records/:recordId/anchor", clinical, (req, res) => {
    res.status(403).json({ error: ANCHOR_REFUSAL });
  });
}

module.exports = {
  registerClinicalRecords,
  recordContentHash,
  presentClinicalRecord,
  clinicalContent,
  stableStringify,
  ANCHOR_REFUSAL,
  CATEGORIES
};
