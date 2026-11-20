const crypto = require("node:crypto");
const { getAddress, verifyMessage } = require("ethers");
const { z } = require("zod");
const { decryptJson, requiredKey } = require("./crypto");
const { issuePatientToken, requirePatient } = require("./auth");
const { presentClinicalRecord } = require("./clinicalRecords");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CLAIM_DELAY_SECONDS = 60 * 60;
const CHALLENGE_MS = 5 * 60 * 1000;
const SECRET_FIELDS = ["secret", "recoveryCode", "claimSecret", "recoverySecret", "privateKey"];

const patientIdSchema = z.string().trim().regex(/^PATIENT-[0-9]{1,12}$/);
const walletSchema = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32Schema = z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/);

function signInRejected() {
  const error = new Error("Patient sign-in could not be verified.");
  error.statusCode = 401;
  return error;
}

function ownershipRejected() {
  const error = new Error("Patient ownership could not be verified.");
  error.statusCode = 401;
  return error;
}

function chainUnavailable() {
  const error = new Error("Service unavailable");
  error.statusCode = 503;
  return error;
}

function rejectRecoveryMaterial(body) {
  if (!body || typeof body !== "object") return;
  for (const name of SECRET_FIELDS) {
    if (body[name] != null && body[name] !== "") {
      const error = new Error("Do not send a recovery secret.");
      error.statusCode = 400;
      throw error;
    }
  }
}

function patientLoginMessage({ patientId, walletAddress, nonce, expiresAt }) {
  return [
    "MedChain Patient Login",
    `Lifetime ID: ${patientId}`,
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`
  ].join("\n");
}

function sameBytes32(left, right) {
  if (!bytes32Schema.safeParse(left).success || !bytes32Schema.safeParse(right).success) return false;
  const a = Buffer.from(left.slice(2), "hex");
  const b = Buffer.from(right.slice(2), "hex");
  return crypto.timingSafeEqual(a, b);
}

function claimCommitmentFrom(registrationController) {
  if (typeof registrationController !== "string" || !registrationController.startsWith("unclaimed:")) return "";
  const value = registrationController.slice("unclaimed:".length);
  return bytes32Schema.safeParse(value).success ? value : "";
}

async function readController(blockchain, patientRef) {
  if (!blockchain || typeof blockchain.getController !== "function") throw chainUnavailable();
  try {
    const controller = await blockchain.getController(patientRef);
    return getAddress(controller).toLowerCase();
  } catch (error) {
    if (error?.statusCode === 503) throw chainUnavailable();
    throw chainUnavailable();
  }
}

function profileFields(value) {
  const source = value && typeof value === "object" ? value : {};
  const profile = {};
  for (const key of ["fullName", "dateOfBirth", "mobile", "email", "emergencyContact"]) {
    if (typeof source[key] === "string" && source[key].trim()) profile[key] = source[key].trim();
  }
  return profile;
}

function registerPatientAuth(app, { db, blockchain, config, authRateLimit }) {
  const patient = requirePatient(config.jwtSecret, {
    loadPatient: (id) => db.getPatientForAuth(id)
  });

  app.post("/patient-auth/challenge", authRateLimit, async (req, res, next) => {
    try {
      rejectRecoveryMaterial(req.body);
      const input = z.object({ patientId: patientIdSchema, walletAddress: walletSchema }).parse(req.body);
      const walletAddress = getAddress(input.walletAddress);
      const record = await db.findConfirmedPatientForAuth(input.patientId);
      if (!record?.did) throw signInRejected();
      const controller = await readController(blockchain, record.did);
      if (controller === ZERO_ADDRESS || controller !== walletAddress.toLowerCase()) throw signInRejected();
      const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
      const expiresAt = new Date(Date.now() + CHALLENGE_MS).toISOString();
      const message = patientLoginMessage({ patientId: record.patientId, walletAddress, nonce, expiresAt });
      await db.createPatientChallenge({
        patientId: record.id,
        walletAddress: walletAddress.toLowerCase(),
        nonce,
        message,
        expiresAt
      });
      res.json({ nonce, message, expiresAt });
    } catch (error) { next(error); }
  });

  app.post("/patient-auth/token", authRateLimit, async (req, res, next) => {
    try {
      rejectRecoveryMaterial(req.body);
      const input = z.object({
        nonce: bytes32Schema,
        signature: z.string().trim().regex(/^0x[0-9a-fA-F]+$/)
      }).parse(req.body);
      const challenge = await db.consumePatientChallenge(input.nonce.toLowerCase());
      if (!challenge?.message || !challenge.walletAddress) throw signInRejected();
      let signer;
      try {
        signer = getAddress(verifyMessage(challenge.message, input.signature)).toLowerCase();
      } catch {
        throw signInRejected();
      }
      if (signer !== challenge.walletAddress) throw signInRejected();
      const record = await db.getPatientForAuth(challenge.patientId);
      if (!record?.did || record.patientId !== challenge.publicPatientId) throw signInRejected();
      const controller = await readController(blockchain, record.did);
      if (controller !== signer) throw signInRejected();
      res.json({
        token: issuePatientToken(record, getAddress(signer), config.jwtSecret)
      });
    } catch (error) { next(error); }
  });

  app.post("/patient-auth/claim-status", authRateLimit, async (req, res, next) => {
    try {
      rejectRecoveryMaterial(req.body);
      const input = z.object({
        patientId: patientIdSchema,
        walletAddress: walletSchema,
        claimCommitment: bytes32Schema
      }).parse(req.body);
      const walletAddress = getAddress(input.walletAddress);
      const record = await db.findConfirmedPatientForAuth(input.patientId);
      const stored = claimCommitmentFrom(record?.registrationController);
      if (!record?.did || !stored || !sameBytes32(stored, input.claimCommitment)) throw ownershipRejected();
      const controller = await readController(blockchain, record.did);
      if (controller !== ZERO_ADDRESS) {
        return res.json({
          status: "controller_set",
          patientId: record.patientId,
          onChainClaim: "complete",
          message: "This record already has a controller. Sign in with that wallet. No claim transaction is submitted."
        });
      }
      res.json({
        status: "unclaimed",
        patientId: record.patientId,
        patientRef: record.did,
        walletAddress,
        commitmentMatches: true,
        onChainClaim: "not_submitted",
        claimDelaySeconds: CLAIM_DELAY_SECONDS,
        message: "The recovery code matches this unclaimed record. The claim transaction is not submitted."
      });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/identity", patient, async (req, res, next) => {
    try {
      const controller = await readController(blockchain, req.patient.did);
      res.json({
        patientId: req.patient.patientId,
        patientRef: req.patient.did,
        status: req.patient.status,
        createdAt: req.patient.createdAt,
        txHash: req.patient.txHash || null,
        walletAddress: req.patient.walletAddress,
        controller: getAddress(controller),
        ownership: controller === ZERO_ADDRESS ? "unclaimed" : "controller",
        onChainClaim: controller === ZERO_ADDRESS ? "not_submitted" : "complete"
      });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/profile", patient, async (req, res, next) => {
    try {
      const key = requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);
      let profile = {};
      if (req.patient.piiCiphertext) {
        try {
          profile = profileFields(decryptJson(req.patient.piiCiphertext, key));
        } catch {
          throw chainUnavailable();
        }
      }
      res.json({ patientId: req.patient.patientId, profile });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/visits", patient, async (req, res, next) => {
    try {
      const visits = await db.listPatientVisits(req.patient.id);
      res.json({
        visits,
        clinicalChart: "encrypted_separately",
        medicalRecordRegistry: "consent_required"
      });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/records", patient, async (req, res, next) => {
    try {
      const key = requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);
      const rows = await db.listMedicalRecordsForPatient(req.patient.id);
      res.json({
        records: rows.map((row) => presentClinicalRecord(row, key)),
        anchoring: "disabled",
        message: "Clinical entries are encrypted for this patient. The hospital wallet does not anchor hashes, and no consent grant is invented here."
      });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/access", patient, async (req, res, next) => {
    try {
      const controller = await readController(blockchain, req.patient.did);
      const wallet = req.patient.walletAddress.toLowerCase();
      const grantingDisabled = controller === ZERO_ADDRESS || controller !== wallet;
      if (typeof blockchain.listConsent !== "function" || typeof blockchain.listEmergency !== "function" || typeof blockchain.listAudit !== "function") {
        throw chainUnavailable();
      }
      const [permissions, emergency, chainAudit] = await Promise.all([
        blockchain.listConsent(req.patient.did),
        blockchain.listEmergency(req.patient.did),
        blockchain.listAudit(req.patient.did)
      ]);
      const local = typeof db.listAccessAuditForPatient === "function"
        ? await db.listAccessAuditForPatient(req.patient.id)
        : [];
      const key = requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);
      res.json({
        status: permissions.some((permission) => permission.active) || emergency.some((session) => session.active) ? "active" : "consent_required",
        permissions,
        emergency: emergency.map((session) => ({
          ...session,
          reason: reasonForPatient(local, session.reasonHash, key)
        })),
        audit: [
          ...chainAudit,
          ...local.map((row) => ({
            actor: getAddress(row.actorWallet),
            action: row.actionCode,
            timestamp: row.createdAt,
            success: true,
            source: "hospital"
          }))
        ],
        patientRef: req.patient.did,
        grantingDisabled,
        broadcast: "disabled",
        message: grantingDisabled
          ? "Only the patient controller can grant consent. No grant is submitted from the hospital wallet."
          : "Prepare the grant in this browser and sign it with the controller wallet. Public networks are not sent without approval."
      });
    } catch (error) { next(error); }
  });
}

function reasonForPatient(rows, reasonHash, key) {
  const row = rows.find((item) => item.reasonHash === reasonHash && item.reasonCiphertext);
  if (!row) return null;
  try {
    const value = decryptJson(row.reasonCiphertext, key);
    return typeof value.reason === "string" ? value.reason : null;
  } catch {
    return null;
  }
}

module.exports = { registerPatientAuth, patientLoginMessage, CLAIM_DELAY_SECONDS };
