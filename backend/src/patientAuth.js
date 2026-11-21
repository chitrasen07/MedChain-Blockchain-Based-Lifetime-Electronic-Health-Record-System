const crypto = require("node:crypto");
const { getAddress, verifyMessage } = require("ethers");
const { z } = require("zod");
const { decryptJson, requiredKey } = require("./crypto");
const { issuePatientToken, requireAuth, requirePatient } = require("./auth");
const { presentClinicalRecord, assembleChart, sendSummaryPdf } = require("./clinicalRecords");
const { emergencyCard, mergeProfile } = require("./chart");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CLAIM_DELAY_SECONDS = 60 * 60;
const CHALLENGE_MS = 5 * 60 * 1000;
const SECRET_FIELDS = ["secret", "recoveryCode", "claimSecret", "recoverySecret", "privateKey"];

const patientIdSchema = z.string().trim().regex(/^PATIENT-[0-9]{1,12}$/);
const walletSchema = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32Schema = z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/);

const UNCLAIMED_SIGNIN = "This record is registered and the wallet is not linked yet. Complete the ownership claim below before signing in.";
const WRONG_WALLET = "This wallet does not control this lifetime ID.";
const STAFF_CONTROLLER = "This lifetime ID is controlled by a hospital staff wallet. Patient sign-in is blocked until that controller proposes a transfer in MetaMask and the patient's wallet accepts it.";
const STAFF_OWNER = "A hospital staff wallet cannot become the patient owner. Connect the patient's own wallet, or register now and link the wallet later.";

function signInRejected(message = "Patient sign-in could not be verified.") {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

async function controllerRole(db, blockchain, wallet) {
  if (!wallet || wallet === ZERO_ADDRESS) return "";
  if (typeof db.findStaffRoleByWallet === "function") {
    const role = await db.findStaffRoleByWallet(wallet);
    if (role) return role;
  }
  if (typeof blockchain?.hospitalSigner === "function") {
    try {
      const signer = getAddress(await blockchain.hospitalSigner()).toLowerCase();
      if (signer === wallet) return "hospital_signer";
    } catch {
      return "";
    }
  }
  return "";
}

async function ownershipFacts(db, blockchain, record, walletAddress) {
  const controller = await readController(blockchain, record.did);
  const staffControlled = Boolean(await controllerRole(db, blockchain, controller));
  const walletIsController = controller !== ZERO_ADDRESS && controller === walletAddress.toLowerCase();
  return { controller, staffControlled, walletIsController };
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

function presentConsentDoctor(row) {
  let walletAddress = "";
  try { walletAddress = getAddress(row?.walletAddress); } catch { return null; }
  const name = typeof row?.fullName === "string" && row.fullName.trim() ? row.fullName.trim() : "Doctor";
  return { name, role: "Doctor", walletAddress };
}

function profileFields(value) {
  const source = value && typeof value === "object" ? value : {};
  const profile = {};
  for (const key of ["fullName", "dateOfBirth", "gender", "bloodGroup", "mobile", "email", "emergencyContact"]) {
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
      const facts = await ownershipFacts(db, blockchain, record, walletAddress);
      if (facts.staffControlled) throw signInRejected(STAFF_CONTROLLER);
      if (facts.controller === ZERO_ADDRESS) throw signInRejected(UNCLAIMED_SIGNIN);
      if (!facts.walletIsController) throw signInRejected(WRONG_WALLET);
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
      const facts = await ownershipFacts(db, blockchain, record, signer);
      if (facts.staffControlled) throw signInRejected(STAFF_CONTROLLER);
      if (!facts.walletIsController) throw signInRejected(WRONG_WALLET);
      res.json({
        token: issuePatientToken(record, getAddress(signer), config.jwtSecret)
      });
    } catch (error) { next(error); }
  });

  app.post("/patient-auth/ownership-status", authRateLimit, async (req, res, next) => {
    try {
      rejectRecoveryMaterial(req.body);
      const input = z.object({ patientId: patientIdSchema, walletAddress: walletSchema }).parse(req.body);
      const walletAddress = getAddress(input.walletAddress);
      const record = await db.findConfirmedPatientForAuth(input.patientId);
      if (!record?.did) throw signInRejected();
      const facts = await ownershipFacts(db, blockchain, record, walletAddress);
      res.json({
        patientId: record.patientId,
        patientRef: record.did,
        ownership: facts.controller === ZERO_ADDRESS ? "unclaimed" : "linked",
        label: facts.controller === ZERO_ADDRESS ? "Registered — Wallet linking pending" : "Registered — Wallet linked",
        staffControlled: facts.staffControlled,
        walletIsController: facts.walletIsController,
        message: facts.staffControlled
          ? STAFF_CONTROLLER
          : facts.controller === ZERO_ADDRESS
            ? UNCLAIMED_SIGNIN
            : facts.walletIsController
              ? "Patient ownership verified."
              : WRONG_WALLET
      });
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId/ownership", requireAuth(config.jwtSecret, ["receptionist", "hospital_staff", "doctor", "reviewer", "administrator"], { loadUser: db.getUserForAuth }), async (req, res, next) => {
    try {
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient?.did) return res.status(404).json({ error: "Patient not found" });
      const bound = typeof db.getClinicalWallet === "function" ? await db.getClinicalWallet(req.user.sub) : "";
      const facts = await ownershipFacts(db, blockchain, { did: patient.did }, bound || ZERO_ADDRESS);
      res.json({
        patientId: patient.patientId,
        patientRef: patient.did,
        ownership: facts.controller === ZERO_ADDRESS ? "unclaimed" : "linked",
        label: facts.controller === ZERO_ADDRESS ? "Registered — Wallet linking pending" : "Registered — Wallet linked",
        staffControlled: facts.staffControlled,
        callerIsController: Boolean(bound) && facts.walletIsController
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
      let claimDelaySeconds = CLAIM_DELAY_SECONDS;
      if (typeof blockchain.getClaimDelay === "function") {
        try {
          const delay = await blockchain.getClaimDelay();
          if (Number.isInteger(delay) && delay > 0) claimDelaySeconds = delay;
        } catch {
          throw chainUnavailable();
        }
      }
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
        claimDelaySeconds,
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
      let correctionRows = [];
      if (typeof db.listDemographicCorrections === "function") {
        try {
          correctionRows = await db.listDemographicCorrections(req.patient.patientId, req.patient.hospital_id);
        } catch (error) {
          if (error?.code !== "42P01") throw error;
        }
      }
      const corrections = correctionRows.map((row) => {
        try { return { ...decryptJson(row.contentCiphertext, key), createdAt: row.createdAt, authorName: row.authorName || null }; } catch { return {}; }
      });
      res.json({ patientId: req.patient.patientId, profile: mergeProfile(profile, [], corrections) });
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

  app.get("/patient-portal/chart", patient, async (req, res, next) => {
    try {
      const key = requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);
      const chart = await assembleChart({ db, blockchain, key, patient: req.patient, access: "patient" });
      if (typeof db.createClinicalAudit === "function") {
        await db.createClinicalAudit({
          hospitalId: req.patient.hospital_id,
          publicPatientId: req.patient.patientId,
          actorRole: "patient",
          action: "record_viewed"
        });
      }
      res.json(chart);
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/chart.pdf", patient, async (req, res, next) => {
    try {
      const key = requiredKey(config.piiEncryptionKey, "PII_ENCRYPTION_KEY", 32);
      const chart = await assembleChart({ db, blockchain, key, patient: req.patient, access: "patient" });
      if (typeof db.createClinicalAudit === "function") {
        await db.createClinicalAudit({
          hospitalId: req.patient.hospital_id,
          publicPatientId: req.patient.patientId,
          actorRole: "patient",
          action: "summary_exported"
        });
      }
      sendSummaryPdf(res, chart);
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/emergency-card", patient, async (req, res, next) => {
    try {
      res.json(emergencyCard(req.patient.patientId));
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
          : "Choose a verified doctor and approve access in MetaMask. The hospital wallet cannot grant consent."
      });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/clinicians", patient, async (req, res, next) => {
    try {
      if (typeof db.listConsentDoctors !== "function") throw chainUnavailable();
      const rows = await db.listConsentDoctors(req.patient.hospital_id);
      res.json({ clinicians: rows.map(presentConsentDoctor).filter(Boolean) });
    } catch (error) { next(error); }
  });

  app.post("/patient-portal/clinicians/authorization", patient, async (req, res, next) => {
    try {
      const parsed = walletSchema.safeParse(req.body?.walletAddress);
      if (!parsed.success) return res.status(400).json({ error: "Choose an active doctor with a verified wallet." });
      if (typeof db.listConsentDoctors !== "function" || typeof blockchain.hasChainRole !== "function") throw chainUnavailable();
      const walletAddress = getAddress(parsed.data);
      const rows = await db.listConsentDoctors(req.patient.hospital_id);
      const match = rows.map(presentConsentDoctor).find((doctor) => doctor && doctor.walletAddress.toLowerCase() === walletAddress.toLowerCase());
      if (!match) return res.status(403).json({ error: "Choose an active doctor with a verified wallet." });
      let authorized = false;
      try {
        authorized = await blockchain.hasChainRole("DOCTOR", walletAddress);
      } catch {
        throw chainUnavailable();
      }
      if (!authorized) return res.status(403).json({ error: "This doctor is not authorized on Sepolia." });
      res.json(match);
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

module.exports = {
  registerPatientAuth,
  patientLoginMessage,
  CLAIM_DELAY_SECONDS,
  patientOwnerBlocked: (db, blockchain, wallet) => controllerRole(db, blockchain, getAddress(wallet).toLowerCase()).then(Boolean),
  STAFF_OWNER,
  STAFF_CONTROLLER,
  UNCLAIMED_SIGNIN,
  WRONG_WALLET
};
