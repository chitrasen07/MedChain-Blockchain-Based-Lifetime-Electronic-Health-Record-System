const crypto = require("node:crypto");
const { getAddress, keccak256, toUtf8Bytes, verifyMessage } = require("ethers");
const { z } = require("zod");
const { decryptJson, encryptJson, requiredKey } = require("./crypto");
const { allergyAlerts, buildPatientChart, emergencyCard } = require("./chart");
const { renderSummaryPdf } = require("./summaryPdf");
const { requireAuth } = require("./auth");
const { recordActivity } = require("./activityAudit");
const {
  ANCHOR_PREPARED,
  CONSENT_REQUIRED,
  assessAnchor,
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
  diagnosis: { condition: true, notes: false, status: false, chronic: false },
  prescription: { medication: true, dose: true, directions: false, dosage: false, frequency: false, route: false, duration: false, instructions: false, startDate: false, endDate: false },
  laboratory: { testName: true, result: true, unit: false, referenceRange: false, collectedOn: false, resultDate: false, notes: false },
  allergy: { substance: true, reaction: false },
  treatment: { treatment: true, outcome: false, kind: false },
  visit: { reason: true, notes: false, symptoms: false, observations: false, checkInAt: false },
  vital: { bloodPressure: false, heartRate: false, temperature: false, spo2: false, respiratoryRate: false, weight: false, height: false, bloodGlucose: false, notes: false }
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

const VITAL_UNITS = {
  bloodPressure: "mmHg",
  heartRate: "bpm",
  temperature: "C",
  spo2: "%",
  respiratoryRate: "breaths/min",
  weight: "kg",
  height: "cm",
  bloodGlucose: "mg/dL"
};

function invalidRequest() {
  const error = new Error("Invalid request");
  error.statusCode = 400;
  return error;
}

function fieldValue(fields, name) {
  const value = typeof fields?.[name] === "string" ? fields[name].trim() : "";
  if (value.length > 2000) throw invalidRequest();
  return value;
}

function optionalDate(value) {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidRequest();
  return value;
}

function clinicalContent(category, recordedOn, fields) {
  const spec = CATEGORIES[category];
  if (!spec) throw invalidRequest();
  const content = { category, recordedOn };
  for (const [name, required] of Object.entries(spec)) {
    const value = fieldValue(fields, name);
    if (!value && required) throw invalidRequest();
    if (value) content[name] = value;
  }
  if (category === "vital") {
    const measured = Object.keys(VITAL_UNITS).filter((name) => content[name]);
    if (!measured.length) throw invalidRequest();
    for (const name of measured) {
      const unit = fieldValue(fields, `${name}Unit`);
      content[`${name}Unit`] = unit && unit.length <= 20 ? unit : VITAL_UNITS[name];
    }
  }
  if (content.status) content.status = content.status.toLowerCase();
  if (content.chronic) content.chronic = content.chronic.toLowerCase();
  if (content.kind) content.kind = content.kind.toLowerCase();
  if (category === "diagnosis" && content.status && !["current", "past"].includes(content.status)) throw invalidRequest();
  if (category === "diagnosis" && content.chronic && !["yes", "no"].includes(content.chronic)) throw invalidRequest();
  if (category === "treatment" && content.kind && !["surgery", "treatment"].includes(content.kind)) throw invalidRequest();
  for (const name of ["startDate", "endDate", "collectedOn", "resultDate"]) {
    if (content[name]) content[name] = optionalDate(content[name]);
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
    workflowStatus: row.workflowStatus || "reviewed",
    transaction: row.txHash || null,
    priorRecordId: row.priorRecordId || null,
    authorName: row.authorName || null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    correctionReason: correctionReasonFor(row, key),
    content
  };
}

function correctionReasonFor(row, key) {
  if (!row.correctionReasonCiphertext) return null;
  try {
    const value = decryptJson(row.correctionReasonCiphertext, key);
    return typeof value?.reason === "string" && value.reason.trim() ? value.reason.trim() : null;
  } catch {
    return null;
  }
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function anchorFacts(blockchain, patientRef, wallet, recordRef) {
  const names = ["isActivePatient", "getController", "hasChainRole", "hasAccess", "getAccessExpiry", "recordVersionCount"];
  if (names.some((name) => typeof blockchain?.[name] !== "function")) throw httpError("Service unavailable", 503);
  const [patientActive, controller, doctorRole, hasAccess, onChainVersions] = await Promise.all([
    blockchain.isActivePatient(patientRef),
    blockchain.getController(patientRef),
    blockchain.hasChainRole("DOCTOR", wallet),
    blockchain.hasAccess(patientRef, wallet),
    blockchain.recordVersionCount(recordRef)
  ]);
  let grantExists = true;
  let expiresAt = null;
  try {
    const expiry = await blockchain.getAccessExpiry(patientRef, wallet);
    expiresAt = expiry == null ? null : Number(expiry);
  } catch (error) {
    if (error?.code === "NO_GRANT" || error?.statusCode === 404) grantExists = false;
    else throw httpError("Service unavailable", 503);
  }
  return {
    chainId: 11155111,
    patientActive: Boolean(patientActive),
    controller,
    doctorRole: Boolean(doctorRole),
    hasAccess: Boolean(hasAccess),
    grantExists,
    expiresAt,
    onChainVersions: Number(onChainVersions),
    wallet
  };
}

function anchorRecordFacts(record) {
  return {
    versionIndex: Number(record.versionIndex),
    chainStatus: record.chainStatus,
    workflowStatus: record.workflowStatus || "reviewed",
    pendingHash: record.txHash || "",
    contentHash: record.contentHash,
    preparedHash: record.contentHash
  };
}

const DOCTOR_REPORTS = new Set(["diagnosis", "prescription", "allergy", "treatment", "laboratory", "visit", "vital"]);
const DOCTOR_ONLY = "Only a doctor can create or correct this report.";
const DOCTOR_ANCHOR = "Only a doctor can anchor a clinical record.";
const CORRECTION_REASON = "Enter a correction reason before saving a new version.";

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
        category: z.enum(["diagnosis", "prescription", "laboratory", "allergy", "treatment", "visit", "vital"]),
        recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        fields: z.record(z.string(), z.string().max(2000)),
        priorRecordId: z.string().uuid().optional(),
        correctionReason: z.string().trim().max(500).optional(),
        workflowStatus: z.enum(["draft", "reviewed"]).optional()
      }).parse(req.body);
      if (req.user.role !== "doctor" || !DOCTOR_REPORTS.has(input.category)) {
        return res.status(403).json({ error: DOCTOR_ONLY });
      }
      if (input.priorRecordId && (input.correctionReason || "").trim().length < 3) {
        return res.status(400).json({ error: CORRECTION_REASON });
      }
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
      let alerts = [];
      if (input.category === "prescription" && typeof db.listMedicalRecordsByPublicId === "function") {
        const existing = await db.listMedicalRecordsByPublicId(patient.patientId, req.user.hospital_id);
        const latest = new Map();
        for (const record of existing.map((row) => presentClinicalRecord(row, key())).filter((record) => record.category === "allergy")) {
          const current = latest.get(record.recordRef);
          if (!current || record.versionIndex > current.versionIndex) latest.set(record.recordRef, record);
        }
        alerts = allergyAlerts([...latest.values()].map((record) => ({
          substance: record.content?.substance,
          reaction: record.content?.reaction
        })), content.medication);
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
        actorId: req.user.sub,
        correctionReasonCiphertext: priorRecordId ? encryptJson({ reason: input.correctionReason.trim() }, key()) : null,
        workflowStatus: input.workflowStatus || "reviewed"
      });
      res.status(201).json({
        id: saved.id,
        category: saved.category,
        recordedOn: recordedOnValue(saved.recordedOn),
        versionIndex: saved.versionIndex,
        recordRef: saved.recordRef,
        contentHash: saved.contentHash,
        chainStatus: saved.chainStatus,
        workflowStatus: saved.workflowStatus || input.workflowStatus || "reviewed",
        transaction: null,
        priorRecordId: saved.priorRecordId,
        correctionReason: priorRecordId ? input.correctionReason.trim() : null,
        content,
        access: mode,
        anchoring: "prepared",
        alerts
      });
      await noteClinicalAudit(db, {
        hospitalId: req.user.hospital_id,
        publicPatientId: patient.patientId,
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: priorRecordId ? "record_corrected" : "record_created",
        category: input.category,
        versionIndex
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
      await noteClinicalAudit(db, {
        hospitalId: req.user.hospital_id,
        publicPatientId: patient.patientId,
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: "record_viewed"
      });
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
      if (req.user.role !== "doctor") return res.status(403).json({ error: DOCTOR_ANCHOR });
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const wallet = await boundWallet(db, req.user.sub);
      if (getAddress(wallet) === getAddress(await blockchain.hospitalSigner())) {
        return res.status(403).json({ error: ANCHOR_REFUSAL });
      }
      const record = await db.getMedicalRecord(req.params.recordId, req.user.hospital_id);
      if (!record || record.publicPatientId !== patient.patientId) {
        return res.status(404).json({ error: "Patient not found" });
      }
      const patientRef = patientReference(patient);
      const decision = assessAnchor({ ...(await anchorFacts(blockchain, patientRef, wallet, record.recordRef)), ...anchorRecordFacts(record) });
      if (!decision.ok) return res.status(decision.status).json({ error: decision.message });
      res.json({
        broadcast: "disabled",
        transaction: record.txHash || null,
        anchoring: "prepared",
        access: "consent",
        recordRef: record.recordRef,
        patientRef,
        contentHash: record.contentHash,
        versionIndex: record.versionIndex,
        chainStatus: record.chainStatus,
        data: anchorCalldata({
          versionIndex: record.versionIndex,
          recordRef: record.recordRef,
          patientRef,
          contentHash: record.contentHash
        }),
        message: ANCHOR_PREPARED,
        contractAddress: typeof blockchain.locatePatient === "function"
          ? (await blockchain.locatePatient(patientRef)).medicalRecords
          : null
      });
    } catch (error) { next(error); }
  });

  app.post("/patients/:patientId/records/:recordId/anchor-result", clinical, async (req, res, next) => {
    try {
      if (req.user.role !== "doctor") return res.status(403).json({ error: DOCTOR_ANCHOR });
      const txHash = z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/).parse(req.body?.transaction);
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const wallet = await boundWallet(db, req.user.sub);
      if (getAddress(wallet) === getAddress(await blockchain.hospitalSigner())) {
        return res.status(403).json({ error: ANCHOR_REFUSAL });
      }
      const record = await db.getMedicalRecord(req.params.recordId, req.user.hospital_id);
      if (!record || record.publicPatientId !== patient.patientId) {
        return res.status(404).json({ error: "Patient not found" });
      }
      if (record.chainStatus === "anchored") {
        return res.json({ chainStatus: "anchored", transaction: record.txHash });
      }
      if (typeof blockchain.confirmRecordAnchor !== "function") throw httpError("Service unavailable", 503);
      const receipt = await blockchain.confirmRecordAnchor(txHash, record.recordRef, record.contentHash);
      if (receipt.status === "pending") {
        if (typeof db.markMedicalRecordChain === "function") {
          await db.markMedicalRecordChain({ id: record.id, hospitalId: req.user.hospital_id, txHash, chainStatus: "consent_required" });
        }
        return res.json({ chainStatus: "pending", transaction: txHash });
      }
      if (receipt.status !== "confirmed") {
        try {
          if (typeof db.markMedicalRecordChain === "function") {
            await db.markMedicalRecordChain({ id: record.id, hospitalId: req.user.hospital_id, txHash, chainStatus: "failed" });
          }
        } catch { /* The failed status is stored after migration 012. */ }
        return res.status(409).json({ error: "The transaction failed on Sepolia. The record was not anchored.", chainStatus: "failed" });
      }
      const saved = typeof db.markMedicalRecordChain === "function"
        ? await db.markMedicalRecordChain({ id: record.id, hospitalId: req.user.hospital_id, txHash, chainStatus: "anchored" })
        : { chainStatus: "anchored", txHash };
      if (!saved) return res.status(409).json({ error: "This version is already anchored. No transaction was sent." });
      await noteClinicalAudit(db, {
        hospitalId: req.user.hospital_id,
        publicPatientId: patient.patientId,
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: "record_anchored",
        category: record.category,
        versionIndex: record.versionIndex,
        txHash
      });
      res.json({ chainStatus: "anchored", transaction: saved.txHash || txHash });
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

  app.get("/patients/:patientId/chart", clinical, async (req, res, next) => {
    try {
      const chart = await clinicalChart(req, db, blockchain, key());
      await noteClinicalAudit(db, {
        hospitalId: req.user.hospital_id,
        publicPatientId: chart.patientId,
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: "record_viewed"
      });
      res.json(chart);
    } catch (error) {
      if (error?.statusCode === 403) await deniedClinicalAccess(db, req);
      next(error);
    }
  });

  app.get("/patients/:patientId/chart.pdf", clinical, async (req, res, next) => {
    try {
      const chart = await clinicalChart(req, db, blockchain, key());
      await noteClinicalAudit(db, {
        hospitalId: req.user.hospital_id,
        publicPatientId: chart.patientId,
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: "summary_exported"
      });
      sendSummaryPdf(res, chart);
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId/emergency-card", clinical, async (req, res, next) => {
    try {
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      res.json(emergencyCard(patient.patientId));
    } catch (error) { next(error); }
  });

  app.post("/patients/:patientId/profile-details", clinical, async (req, res, next) => {
    try {
      const input = z.object({
        gender: z.string().trim().max(40).optional(),
        bloodGroup: z.string().trim().max(16).optional()
      }).parse(req.body);
      const gender = input.gender || "";
      const bloodGroup = input.bloodGroup || "";
      if (!gender && !bloodGroup) return res.status(400).json({ error: "Invalid request" });
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      const wallet = await boundWallet(db, req.user.sub);
      const mode = await clinicalMode(blockchain, patientReference(patient), wallet);
      if (mode !== "consent") return res.status(403).json({ error: CONSENT_REQUIRED });
      if (typeof db.createProfileNote !== "function") throw httpError("Service unavailable", 503);
      await db.createProfileNote({
        publicPatientId: patient.patientId,
        hospitalId: req.user.hospital_id,
        contentCiphertext: encryptJson({ gender, bloodGroup }, key()),
        actorId: req.user.sub
      });
      res.status(201).json({ gender: gender || null, bloodGroup: bloodGroup || null });
    } catch (error) { next(error); }
  });
}

async function deniedClinicalAccess(db, req) {
  await recordActivity(db, {
    actorId: req.user?.id,
    actorRole: req.user?.role,
    hospitalId: req.user?.hospital_id,
    publicPatientId: req.params?.patientId,
    action: "ACCESS_DENIED",
    category: "security",
    outcome: "denied"
  }).catch(() => {});
}

async function noteClinicalAudit(db, input) {
  if (typeof db.createClinicalAudit !== "function") return;
  try {
    await db.createClinicalAudit(input);
  } catch (error) {
    if (error?.code !== "42P01") throw error;
  }
}

async function optionalRows(read) {
  try {
    return await read();
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

async function safeChain(read) {
  try {
    return await read();
  } catch {
    return [];
  }
}

async function clinicalChart(req, db, blockchain, key) {
  if (typeof db.getPatientChartSource !== "function") throw httpError("Service unavailable", 503);
  const patient = await db.getPatientChartSource(req.params.patientId, req.user.hospital_id);
  if (!patient) {
    const error = new Error("Patient not found");
    error.statusCode = 404;
    throw error;
  }
  const wallet = await boundWallet(db, req.user.sub);
  const mode = await clinicalMode(blockchain, patientReference(patient), wallet);
  return assembleChart({
    db,
    blockchain,
    key,
    patient,
    access: mode,
    actor: { id: req.user.sub, role: req.user.role }
  });
}

async function assembleChart({ db, blockchain, key, patient, access }) {
  const rows = typeof db.listMedicalRecordsByPublicId === "function"
    ? await db.listMedicalRecordsByPublicId(patient.patientId, patient.hospital_id || patient.hospitalId)
    : await db.listMedicalRecordsForPatient(patient.id);
  const records = rows.map((row) => presentClinicalRecord(row, key))
    .filter((record) => access === "consent" || record.workflowStatus !== "draft");
  let profile = {};
  if (patient.piiCiphertext) {
    try { profile = decryptJson(patient.piiCiphertext, key); } catch { profile = {}; }
  }
  const noteRows = typeof db.listProfileNotes === "function"
    ? await optionalRows(() => db.listProfileNotes(patient.patientId, patient.hospital_id || patient.hospitalId))
    : [];
  const profileNotes = noteRows.map((row) => {
    try { return { ...decryptJson(row.contentCiphertext, key), createdAt: row.createdAt }; } catch { return {}; }
  });
  const correctionRows = typeof db.listDemographicCorrections === "function"
    ? await optionalRows(() => db.listDemographicCorrections(patient.patientId, patient.hospital_id || patient.hospitalId))
    : [];
  const demographicCorrections = correctionRows.map((row) => {
    try { return { ...decryptJson(row.contentCiphertext, key), createdAt: row.createdAt, authorName: row.authorName || null }; } catch { return {}; }
  });
  const visits = typeof db.listPatientVisits === "function" ? await db.listPatientVisits(patient.id) : [];
  const permissions = access === "emergency" ? [] : await safeChain(() => blockchain.listConsent(patient.did));
  const consentHistory = access === "emergency" || typeof blockchain.listConsentHistory !== "function"
    ? []
    : await safeChain(() => blockchain.listConsentHistory(patient.did));
  const doctors = typeof db.listConsentDoctors === "function" ? await db.listConsentDoctors(patient.hospital_id || patient.hospitalId) : [];
  const localAudit = typeof db.listClinicalAudit === "function"
    ? await optionalRows(() => db.listClinicalAudit(patient.patientId, patient.hospital_id || patient.hospitalId))
    : [];
  const accessAudit = typeof db.listAccessAuditForHospital === "function"
    ? await db.listAccessAuditForHospital(patient.patientId, patient.hospital_id || patient.hospitalId)
    : [];
  const chainAudit = await safeChain(() => blockchain.listAudit(patient.did));
  const audit = [
    ...localAudit.map((row) => ({
      action: row.action,
      actor: row.authorName || row.actorRole,
      actorRole: row.actorRole,
      at: row.createdAt,
      category: row.category,
      version: row.versionIndex,
      transaction: row.txHash,
      source: "hospital"
    })),
    ...accessAudit.map((row) => ({
      action: row.actionCode,
      actor: row.actorWallet,
      at: row.createdAt,
      transaction: row.txHash,
      source: "hospital"
    })),
    ...chainAudit.map((row) => ({
      action: row.action,
      actor: row.actor,
      at: row.timestamp ? new Date(Number(row.timestamp) * 1000).toISOString() : null,
      source: "chain"
    }))
  ];
  return buildPatientChart({
    profile,
    profileNotes,
    patientId: patient.patientId,
    patientRef: patient.did,
    records,
    visits,
    permissions,
    consentHistory,
    doctors: doctors.map((doctor) => ({ name: doctor.fullName || doctor.name, walletAddress: doctor.walletAddress })),
    audit,
    today: todayUtc(),
    access,
    demographicCorrections
  });
}

function sendSummaryPdf(res, chart) {
  const body = renderSummaryPdf(chart);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=\"medchain-summary.pdf\"");
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
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

async function openClinicalAccess({ db, blockchain, userId, patient }) {
  const wallet = await boundWallet(db, userId);
  const mode = await clinicalMode(blockchain, patientReference(patient), wallet);
  return mode;
}

module.exports = {
  registerClinicalRecords,
  recordContentHash,
  presentClinicalRecord,
  clinicalContent,
  stableStringify,
  ANCHOR_REFUSAL,
  CATEGORIES,
  clinicalWalletMessage,
  assembleChart,
  sendSummaryPdf,
  openClinicalAccess,
  noteClinicalAudit,
  DOCTOR_ONLY,
  DOCTOR_ANCHOR,
  CORRECTION_REASON
};
