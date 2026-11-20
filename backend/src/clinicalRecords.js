const crypto = require("node:crypto");
const { getAddress, keccak256, toUtf8Bytes, verifyMessage } = require("ethers");
const { z } = require("zod");
const { decryptJson, encryptJson, requiredKey } = require("./crypto");
const { requireAuth } = require("./auth");
const {
  ANCHOR_PREPARED,
  CONSENT_REQUIRED,
  EMERGENCY_CATEGORIES,
  EMERGENCY_COOLDOWN,
  EMERGENCY_LIMIT,
  EMERGENCY_MAX_SECONDS,
  HOSPITAL_BYPASS,
  NOT_RESPONDER,
  WALLET_REQUIRED,
  anchorCalldata,
  decideClinicalAccess,
  emergencyCalldata,
  httpError,
  reasonHash
} = require("./consentChain");

const CATEGORIES = {
  diagnosis: { condition: true, notes: false },
  prescription: { medication: true, dose: true, directions: false },
  laboratory: { testName: true, result: true, unit: false },
  allergy: { substance: true, reaction: false },
  treatment: { treatment: true, outcome: false },
  visit: { reason: true, notes: false }
};

const ANCHOR_REFUSAL = "The hospital wallet cannot anchor a medical record. Patient consent is required.";
const CHALLENGE_MS = 5 * 60 * 1000;
const SESSION_MS = 15 * 60 * 1000;
const walletSchema = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/);

function clinicalWalletMessage({ userId, walletAddress, nonce, expiresAt }) {
  return [
    "MedChain Clinical Wallet",
    `Staff: ${userId}`,
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`
  ].join("\n");
}

function chainDenied(error) {
  if (error?.statusCode === 403 || error?.statusCode === 404) throw error;
  throw httpError("Service unavailable", 503);
}

async function boundWallet(db, userId) {
  if (typeof db.getClinicalWallet !== "function") throw httpError(WALLET_REQUIRED, 403);
  const wallet = await db.getClinicalWallet(userId);
  if (!wallet) throw httpError(WALLET_REQUIRED, 403);
  return getAddress(wallet);
}

async function clinicalMode(blockchain, patientRef, wallet) {
  try {
    if (!blockchain?.hasAccess || !blockchain?.isMedicalStaff || !blockchain?.checkEmergencyAccess || !blockchain?.hospitalSigner) {
      throw httpError("Service unavailable", 503);
    }
    const hospitalSigner = await blockchain.hospitalSigner();
    const [medicalStaff, access, emergency] = await Promise.all([
      blockchain.isMedicalStaff(wallet),
      blockchain.hasAccess(patientRef, wallet),
      blockchain.checkEmergencyAccess(patientRef, wallet)
    ]);
    return decideClinicalAccess({
      wallet,
      hospitalSigner,
      medicalStaff: Boolean(medicalStaff),
      hasAccess: Boolean(access),
      emergency: Boolean(emergency)
    });
  } catch (error) {
    chainDenied(error);
  }
}

function patientReference(patient) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(patient?.did || "")) throw httpError("Service unavailable", 503);
  return patient.did;
}

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

function registerClinicalRecords(app, { db, blockchain, config, authRateLimit }) {
  const clinical = requireAuth(
    config.jwtSecret,
    ["doctor", "hospital_staff"],
    { loadUser: db.getUserForAuth }
  );
  const key = () => requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);
  const limit = authRateLimit || ((_req, _res, next) => next());

  app.post("/clinical-wallet/challenge", limit, clinical, async (req, res, next) => {
    try {
      const input = walletSchema.parse(req.body?.walletAddress);
      const walletAddress = getAddress(input);
      const signer = await blockchain.hospitalSigner();
      if (getAddress(signer) === walletAddress) throw httpError(HOSPITAL_BYPASS, 403);
      const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
      const expiresAt = new Date(Date.now() + CHALLENGE_MS).toISOString();
      const message = clinicalWalletMessage({ userId: req.user.sub, walletAddress, nonce, expiresAt });
      await db.createClinicalChallenge({
        userId: req.user.sub,
        walletAddress: walletAddress.toLowerCase(),
        nonce,
        message,
        expiresAt
      });
      res.json({ nonce, message, expiresAt });
    } catch (error) { next(error); }
  });

  app.post("/clinical-wallet/session", limit, clinical, async (req, res, next) => {
    try {
      const input = z.object({
        walletAddress: walletSchema,
        nonce: z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/),
        signature: z.string().trim().regex(/^0x[0-9a-fA-F]{130}$/)
      }).parse(req.body);
      const walletAddress = getAddress(input.walletAddress);
      const signer = await blockchain.hospitalSigner();
      if (getAddress(signer) === walletAddress) throw httpError(HOSPITAL_BYPASS, 403);
      const challenge = await db.consumeClinicalChallenge(input.nonce);
      if (!challenge || challenge.userId !== req.user.sub || getAddress(challenge.walletAddress) !== walletAddress) {
        throw httpError("Clinical wallet could not be verified.", 401);
      }
      const recovered = verifyMessage(challenge.message, input.signature);
      if (getAddress(recovered) !== walletAddress) throw httpError("Clinical wallet could not be verified.", 401);
      const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
      await db.saveClinicalWallet({ userId: req.user.sub, walletAddress: walletAddress.toLowerCase(), expiresAt });
      res.json({ walletAddress, expiresAt });
    } catch (error) { next(error); }
  });

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
      const wallet = await boundWallet(db, req.user.sub);
      const mode = await clinicalMode(blockchain, patientReference(patient), wallet);
      if (mode === "emergency" && !EMERGENCY_CATEGORIES.has(input.category)) {
        return res.status(403).json({ error: EMERGENCY_LIMIT });
      }
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
        access: mode,
        anchoring: "prepared"
      });
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId/records", clinical, async (req, res, next) => {
    try {
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const wallet = await boundWallet(db, req.user.sub);
      const mode = await clinicalMode(blockchain, patientReference(patient), wallet);
      const rows = await db.listMedicalRecordsByPublicId(patient.patientId, req.user.hospital_id);
      const records = rows.map((row) => presentClinicalRecord(row, key()))
        .filter((record) => mode !== "emergency" || EMERGENCY_CATEGORIES.has(record.category));
      res.json({
        patientId: patient.patientId,
        records,
        access: mode,
        anchoring: "prepared"
      });
    } catch (error) { next(error); }
  });

  app.post("/patients/:patientId/records/:recordId/anchor", clinical, async (req, res, next) => {
    try {
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const wallet = await boundWallet(db, req.user.sub);
      let mode;
      try {
        mode = await clinicalMode(blockchain, patientReference(patient), wallet);
      } catch (error) {
        if (error.statusCode === 403 && error.message === CONSENT_REQUIRED) {
          return res.status(403).json({ error: ANCHOR_REFUSAL });
        }
        throw error;
      }
      if (getAddress(wallet) === getAddress(await blockchain.hospitalSigner())) {
        return res.status(403).json({ error: ANCHOR_REFUSAL });
      }
      const record = await db.getMedicalRecord(req.params.recordId, req.user.hospital_id);
      if (!record || record.publicPatientId !== patient.patientId) {
        return res.status(404).json({ error: "Patient not found" });
      }
      if (mode === "emergency" && !EMERGENCY_CATEGORIES.has(record.category)) {
        return res.status(403).json({ error: EMERGENCY_LIMIT });
      }
      const patientRef = patientReference(patient);
      res.json({
        broadcast: "disabled",
        transaction: null,
        anchoring: "prepared",
        access: mode,
        recordRef: record.recordRef,
        patientRef,
        contentHash: record.contentHash,
        versionIndex: record.versionIndex,
        data: anchorCalldata({
          versionIndex: record.versionIndex,
          recordRef: record.recordRef,
          patientRef,
          contentHash: record.contentHash
        }),
        message: ANCHOR_PREPARED
      });
    } catch (error) { next(error); }
  });

  app.post("/patients/:patientId/emergency-access", clinical, async (req, res, next) => {
    try {
      const input = z.object({
        reason: z.string().trim().min(8).max(500),
        durationSeconds: z.number().int().min(1).max(EMERGENCY_MAX_SECONDS)
      }).parse(req.body);
      if (req.body?.privateKey || req.body?.recoveryCode) throw httpError("Invalid request", 400);
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const wallet = await boundWallet(db, req.user.sub);
      const patientRef = patientReference(patient);
      const signer = await blockchain.hospitalSigner();
      if (getAddress(signer) === wallet) throw httpError(HOSPITAL_BYPASS, 403);
      const responder = await blockchain.isEmergencyResponder(wallet);
      if (!responder) throw httpError(NOT_RESPONDER, 403);
      if (await blockchain.emergencyCooldown(patientRef, wallet)) throw httpError(EMERGENCY_COOLDOWN, 403);
      const hash = reasonHash(input.reason);
      await db.createAccessAudit({
        hospitalId: req.user.hospital_id,
        publicPatientId: patient.patientId,
        patientRef,
        actorWallet: wallet.toLowerCase(),
        actionCode: "EMERGENCY_PREPARED",
        reasonCiphertext: encryptJson({ reason: input.reason }, key()),
        reasonHash: hash,
        txHash: null,
        expiresAt: null
      });
      res.json({
        broadcast: "disabled",
        transaction: null,
        patientRef,
        reasonHash: hash,
        durationSeconds: input.durationSeconds,
        data: emergencyCalldata(patientRef, input.reason, input.durationSeconds),
        message: "Sign this with the emergency responder wallet. The reason stays off-chain. Public networks are not sent without approval."
      });
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId/emergency-access", clinical, async (req, res, next) => {
    try {
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const wallet = await boundWallet(db, req.user.sub);
      const patientRef = patientReference(patient);
      if (getAddress(await blockchain.hospitalSigner()) === wallet) throw httpError(HOSPITAL_BYPASS, 403);
      if (!await blockchain.isEmergencyResponder(wallet)) throw httpError(NOT_RESPONDER, 403);
      const sessions = await blockchain.listEmergency(patientRef);
      const local = typeof db.listAccessAuditForHospital === "function"
        ? await db.listAccessAuditForHospital(patient.patientId, req.user.hospital_id)
        : [];
      res.json({
        broadcast: "disabled",
        sessions: sessions.map((session) => ({
          wallet: session.wallet,
          status: session.status,
          active: session.active,
          expiresAt: session.expiresAt,
          cooldownEndsAt: session.cooldownEndsAt,
          reasonHash: session.reasonHash,
          reason: reasonForActor(local, session, wallet, key())
        }))
      });
    } catch (error) { next(error); }
  });
}

function reasonForActor(rows, session, wallet, key) {
  if (getAddress(session.wallet) !== wallet) return null;
  const row = rows.find((item) => item.reasonHash === session.reasonHash && item.reasonCiphertext);
  if (!row) return null;
  try {
    const value = decryptJson(row.reasonCiphertext, key);
    return typeof value.reason === "string" ? value.reason : null;
  } catch {
    return null;
  }
}

module.exports = {
  registerClinicalRecords,
  recordContentHash,
  presentClinicalRecord,
  clinicalContent,
  stableStringify,
  ANCHOR_REFUSAL,
  CATEGORIES,
  clinicalWalletMessage
};
