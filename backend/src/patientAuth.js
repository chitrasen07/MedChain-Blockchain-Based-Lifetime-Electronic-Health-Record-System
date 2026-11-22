const crypto = require("node:crypto");
const { getAddress, verifyMessage } = require("ethers");
const { z } = require("zod");
const { decryptJson, requiredKey } = require("./crypto");
const { issuePatientToken, requireAuth, requirePatient } = require("./auth");
const { presentClinicalRecord, assembleChart, sendSummaryPdf } = require("./clinicalRecords");
const { emergencyCard, mergeProfile } = require("./chart");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CLAIM_DELAY_SECONDS = 60 * 60;
const CLAIM_WINDOW_SECONDS = 24 * 60 * 60;
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

function sameHash(left, right) {
  return bytes32Schema.safeParse(left).success && bytes32Schema.safeParse(right).success && left.toLowerCase() === right.toLowerCase();
}

function describeClaimState({
  controller,
  walletAddress,
  announcement = null,
  sealedClaim = "",
  delaySeconds = CLAIM_DELAY_SECONDS,
  windowSeconds = CLAIM_WINDOW_SECONDS,
  now = Math.floor(Date.now() / 1000)
}) {
  const normalizedController = String(controller || ZERO_ADDRESS).toLowerCase();
  const wallet = String(walletAddress || "").toLowerCase();
  if (normalizedController !== ZERO_ADDRESS) {
    const matches = normalizedController === wallet;
    return {
      status: "controller_set",
      onChainClaim: "complete",
      canAnnounce: false,
      canReveal: false,
      remainingSeconds: 0,
      walletIsController: matches,
      message: matches
        ? "Wallet linked successfully. This patient can sign in with this wallet."
        : "This record already has a controller. Sign in with that wallet. No claim transaction is submitted."
    };
  }
  if (!announcement?.announced || !announcement.announcedAt) {
    return {
      status: "unclaimed",
      onChainClaim: "not_submitted",
      canAnnounce: true,
      canReveal: false,
      remainingSeconds: 0,
      message: "Recovery code valid. No announce transaction is on Sepolia yet."
    };
  }
  const announcedAt = Number(announcement.announcedAt);
  const readyAt = announcedAt + Number(delaySeconds);
  const replaceableAt = readyAt + Number(windowSeconds);
  const claimant = String(announcement.claimant || "").toLowerCase();
  const sameWallet = Boolean(claimant) && claimant === wallet;
  const remainingSeconds = Math.max(0, readyAt - now);
  const shared = {
    announcedAt,
    announceTx: announcement.txHash || "",
    remainingSeconds,
    readyAt,
    replaceableAt
  };
  if (!sameWallet) {
    const replaceable = now >= replaceableAt;
    return {
      ...shared,
      status: "announced",
      onChainClaim: "wrong_wallet",
      canAnnounce: replaceable,
      canReveal: false,
      message: replaceable
        ? "Wrong MetaMask account. This wallet can replace the earlier announcement, and that starts a new one-hour wait."
        : "Wrong MetaMask account. Connect the wallet that announced this claim."
    };
  }
  if (sealedClaim && announcement.pendingClaimHash && !sameHash(sealedClaim, announcement.pendingClaimHash)) {
    return {
      ...shared,
      status: "announced",
      onChainClaim: "mismatch",
      canAnnounce: true,
      canReveal: false,
      message: "Announce confirmed, but it does not match this recovery code. Announcing again restarts the one-hour contract wait."
    };
  }
  if (now < readyAt) {
    return {
      ...shared,
      status: "announced",
      onChainClaim: "announced",
      canAnnounce: false,
      canReveal: false,
      message: "Announce confirmed. Do not announce again. Reveal stays locked until the contract waiting period ends."
    };
  }
  return {
    ...shared,
    status: "ready",
    onChainClaim: "ready",
    canAnnounce: false,
    canReveal: true,
    message: "Ready to reveal. Do not announce again. After the reveal confirms, sign in with this same wallet."
  };
}

async function readClaimTiming(blockchain) {
  let claimDelaySeconds = CLAIM_DELAY_SECONDS;
  let claimWindowSeconds = CLAIM_WINDOW_SECONDS;
  if (typeof blockchain?.getClaimDelay === "function") {
    const delay = await blockchain.getClaimDelay();
    if (!Number.isInteger(delay) || delay <= 0) throw chainUnavailable();
    claimDelaySeconds = delay;
  }
  if (typeof blockchain?.getClaimWindow === "function") {
    const claimWindow = await blockchain.getClaimWindow();
    if (!Number.isInteger(claimWindow) || claimWindow <= 0) throw chainUnavailable();
    claimWindowSeconds = claimWindow;
  }
  return { claimDelaySeconds, claimWindowSeconds };
}

async function readAnnouncement(blockchain, patientRef) {
  if (typeof blockchain?.getClaimAnnouncement !== "function") return null;
  try {
    return await blockchain.getClaimAnnouncement(patientRef);
  } catch (error) {
    if (error?.statusCode === 503) throw chainUnavailable();
    throw chainUnavailable();
  }
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

function instantTypedData(registryAddress, patientRef, claimCommitment, chainId) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      ClaimController: [
        { name: "patientRef", type: "bytes32" },
        { name: "claimCommitment", type: "bytes32" }
      ]
    },
    primaryType: "ClaimController",
    domain: {
      name: "MedChain Patient Registry",
      version: "2",
      chainId: Number(chainId) || 11155111,
      verifyingContract: registryAddress
    },
    message: { patientRef, claimCommitment }
  };
}

function registerPatientAuth(app, { db, blockchain, config, authRateLimit }) {
  app.get("/patient-auth/claim-mode", (_req, res) => {
    res.json({ instant: Boolean(config.instantRegistry) });
  });
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
      const located = facts.controller === ZERO_ADDRESS && typeof blockchain.locatePatient === "function"
        ? await blockchain.locatePatient(record.did)
        : null;
      const instant = located?.claimMode === "instant";
      const announcement = facts.controller === ZERO_ADDRESS && !instant ? await readAnnouncement(blockchain, record.did) : null;
      const timing = announcement?.announced ? await readClaimTiming(blockchain) : { claimDelaySeconds: CLAIM_DELAY_SECONDS, claimWindowSeconds: CLAIM_WINDOW_SECONDS };
      const claim = facts.controller === ZERO_ADDRESS
        ? describeClaimState({ controller: facts.controller, walletAddress, announcement, ...timing })
        : null;
      const unclaimedMessage = claim && claim.onChainClaim !== "not_submitted" ? claim.message : UNCLAIMED_SIGNIN;
      res.json({
        patientId: record.patientId,
        patientRef: record.did,
        ownership: facts.controller === ZERO_ADDRESS ? "unclaimed" : "linked",
        label: facts.controller === ZERO_ADDRESS ? "Registered — Wallet linking pending" : "Registered — Wallet linked",
        staffControlled: facts.staffControlled,
        walletIsController: facts.walletIsController,
        claimMode: instant ? "instant" : (facts.controller === ZERO_ADDRESS ? "legacy" : "linked"),
        onChainClaim: instant ? "instant" : (claim?.onChainClaim || (facts.controller === ZERO_ADDRESS ? "not_submitted" : "complete")),
        announcedAt: claim?.announcedAt || 0,
        remainingSeconds: claim?.remainingSeconds || 0,
        canReveal: claim?.canReveal === true,
        message: facts.staffControlled
          ? STAFF_CONTROLLER
          : instant
            ? "This record can be linked immediately. Check the recovery code, then approve the wallet link."
            : facts.controller === ZERO_ADDRESS
            ? unclaimedMessage
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
        claimCommitment: bytes32Schema,
        sealedClaim: bytes32Schema.optional()
      }).parse(req.body);
      const walletAddress = getAddress(input.walletAddress);
      const record = await db.findConfirmedPatientForAuth(input.patientId);
      const stored = claimCommitmentFrom(record?.registrationController);
      if (!record?.did || !stored || !sameBytes32(stored, input.claimCommitment)) throw ownershipRejected();
      const located = typeof blockchain.locatePatient === "function" ? await blockchain.locatePatient(record.did) : null;
      if (located?.claimMode === "instant") {
        if (await controllerRole(db, blockchain, walletAddress.toLowerCase())) {
          return res.status(409).json({ error: STAFF_OWNER });
        }
        return res.json({
          claimMode: "instant",
          onChainClaim: "instant",
          canLink: true,
          canAnnounce: false,
          canReveal: false,
          remainingSeconds: 0,
          announcedAt: 0,
          message: "Recovery code verified. Approve the wallet link in MetaMask. It is recorded immediately.",
          patientId: record.patientId,
          patientRef: record.did,
          walletAddress: walletAddress.toLowerCase(),
          commitmentMatches: true,
          registryAddress: located.registryAddress,
          typedData: instantTypedData(located.registryAddress, record.did, stored, config.chainId)
        });
      }
      const controller = located?.controller || await readController(blockchain, record.did);
      const announcement = await readAnnouncement(blockchain, record.did);
      const timing = await readClaimTiming(blockchain);
      const claim = describeClaimState({
        controller,
        walletAddress,
        announcement,
        sealedClaim: input.sealedClaim || "",
        delaySeconds: timing.claimDelaySeconds,
        windowSeconds: timing.claimWindowSeconds
      });
      res.json({
        ...claim,
        claimMode: "legacy",
        patientId: record.patientId,
        patientRef: record.did,
        walletAddress,
        commitmentMatches: true,
        claimDelaySeconds: timing.claimDelaySeconds,
        claimWindowSeconds: timing.claimWindowSeconds
      });
    } catch (error) { next(error); }
  });

  app.get("/patient-portal/identity", patient, async (req, res, next) => {
    try {
      const located = typeof blockchain.locatePatient === "function" ? await blockchain.locatePatient(req.patient.did) : null;
      const controller = located?.controller || await readController(blockchain, req.patient.did);
      res.json({
        patientId: req.patient.patientId,
        patientRef: req.patient.did,
        status: req.patient.status,
        createdAt: req.patient.createdAt,
        txHash: req.patient.txHash || null,
        walletAddress: req.patient.walletAddress,
        controller: getAddress(controller),
        ownership: controller === ZERO_ADDRESS ? "unclaimed" : "controller",
        onChainClaim: controller === ZERO_ADDRESS ? "not_submitted" : "complete",
        claimMode: located?.claimMode || (controller === ZERO_ADDRESS ? "legacy" : "linked"),
        recordAccessAddress: located?.recordAccess || null,
        medicalRecordAddress: located?.medicalRecords || null
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
  CLAIM_WINDOW_SECONDS,
  describeClaimState,
  patientOwnerBlocked: (db, blockchain, wallet) => controllerRole(db, blockchain, getAddress(wallet).toLowerCase()).then(Boolean),
  STAFF_OWNER,
  STAFF_CONTROLLER,
  UNCLAIMED_SIGNIN,
  WRONG_WALLET
};
