const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");
const { z } = require("zod");
const { encryptJson, decryptJson, fieldHash } = require("./crypto");
const { issueToken, requireAuth } = require("./auth");
const { registerPatientAuth } = require("./patientAuth");
const { registerClinicalRecords } = require("./clinicalRecords");
const { registerNursing } = require("./nursing");
const { getAddress, verifyMessage } = require("ethers");
const { passwordChangeMessage } = require("./passwordChange");
const {
  WALLET_REQUIRED,
  chainRoleFor,
  isClinicalRole,
  messageMatches,
  staffWalletMessage
} = require("./staffAuthorization");

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mobile: z.string().trim().max(40).optional(),
  email: z.string().email().max(320).optional(),
  emergencyContact: z.string().trim().max(200).optional(),
  gender: z.string().trim().max(40).optional(),
  bloodGroup: z.string().trim().max(16).optional()
});

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const DUPLICATE_COMMITMENT_MESSAGE = "A patient with this identity commitment is already registered.";

function readPatientOwnership(body) {
  const address = typeof body.controller === "string" ? body.controller.trim() : "";
  const claim = typeof body.claimCommitment === "string" ? body.claimCommitment.trim() : "";
  const controller = /^0x[0-9a-fA-F]{40}$/.test(address) ? address : "";
  const claimCommitment = /^0x[0-9a-fA-F]{64}$/.test(claim) ? claim : "";
  const hasController = controller && controller.toLowerCase() !== ZERO_ADDRESS;
  const hasClaim = claimCommitment && claimCommitment.toLowerCase() !== ZERO_BYTES32;
  if (hasController === hasClaim) {
    const error = new Error(hasController
      ? "Provide either a patient controller or an ownership claim commitment."
      : "A patient controller or an ownership claim commitment is required.");
    error.statusCode = 400;
    throw error;
  }
  return hasController
    ? { controller, claimCommitment: ZERO_BYTES32, storedController: controller }
    : { controller: ZERO_ADDRESS, claimCommitment, storedController: `unclaimed:${claimCommitment}` };
}

function ownershipFromRegistration(registration, fallback) {
  const stored = registration?.controller;
  if (typeof stored !== "string" || !stored) return fallback;
  if (stored.startsWith("unclaimed:")) {
    return { controller: ZERO_ADDRESS, claimCommitment: stored.slice("unclaimed:".length), storedController: stored };
  }
  return { controller: stored, claimCommitment: ZERO_BYTES32, storedController: stored };
}

const DEMO_RATE_LIMIT_PATHS = new Set([
  "/clinical-wallet/challenge",
  "/clinical-wallet/session",
  "/patient-registration/wallet-challenge",
  "/admin/staff-wallet/challenge"
]);
const PATIENT_AUTH_WINDOW_MS = 15 * 60 * 1000;
const PATIENT_AUTH_LIMIT = 8;
const PATIENT_AUTH_IP_LIMIT = 30;

function waitLabel(seconds) {
  const value = Math.max(1, Math.ceil(Number(seconds) || 1));
  if (value >= 120) return `${Math.ceil(value / 60)} minutes`;
  if (value >= 60) return "1 minute";
  return value === 1 ? "1 second" : `${value} seconds`;
}

function patientSubject(body) {
  const patientId = typeof body?.patientId === "string" ? body.patientId.trim().toUpperCase() : "";
  if (/^PATIENT-[0-9]{1,12}$/.test(patientId)) return patientId;
  const wallet = typeof body?.walletAddress === "string" ? body.walletAddress.trim().toLowerCase() : "";
  if (/^0x[0-9a-f]{40}$/.test(wallet)) return wallet;
  return "unknown";
}

function patientAuthLimiter({ limit, keyGenerator }) {
  return rateLimit({
    windowMs: PATIENT_AUTH_WINDOW_MS,
    limit,
    standardHeaders: true,
    skipSuccessfulRequests: true,
    keyGenerator,
    handler(_req, res) {
      const retryAfterSeconds = Number(res.getHeader("Retry-After")) || Math.ceil(PATIENT_AUTH_WINDOW_MS / 1000);
      res.status(429).json({
        error: `Too many sign-in attempts for this patient. Wait ${waitLabel(retryAfterSeconds)} and try again.`,
        retryAfterSeconds
      });
    }
  });
}

function patientAuthRateLimit() {
  const byPatient = patientAuthLimiter({
    limit: PATIENT_AUTH_LIMIT,
    keyGenerator: (req) => `${req.ip}:${patientSubject(req.body)}`
  });
  const byAddress = patientAuthLimiter({
    limit: PATIENT_AUTH_IP_LIMIT,
    keyGenerator: (req) => req.ip
  });
  return (req, res, next) => byAddress(req, res, (error) => error ? next(error) : byPatient(req, res, next));
}

function skipDemoRateLimit(config) {
  return (req) => Boolean(config.demoDisableRateLimit) && DEMO_RATE_LIMIT_PATHS.has(req.path);
}

function createApp({ db, blockchain, config }) {
  const app = express();
  app.set("trust proxy", config.trustProxy === 1 ? 1 : false);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "32kb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true, skip: skipDemoRateLimit(config) }));
  const authRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, skip: skipDemoRateLimit(config) });
  const passwordRateLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: true,
    message: { error: "Too many password changes. Wait and try again." }
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_req, res, next) => {
    try { await db.checkReady(); res.json({ status: "ready" }); } catch (error) {
      error.statusCode = 503;
      next(error);
    }
  });

  app.post("/auth/token", authRateLimit, async (req, res, next) => {
    try {
      const input = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
      const user = await db.authenticateUser(input.email, input.password);
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      res.json({ token: issueToken(user, config.jwtSecret) });
    } catch (error) { next(error); }
  });
  app.post("/auth/bootstrap", authRateLimit, async (req, res, next) => {
    try {
      if (!config.bootstrapSecret || req.headers["x-bootstrap-secret"] !== config.bootstrapSecret) {
        return res.status(403).json({ error: "Bootstrap unavailable" });
      }
      const input = z.object({
        email: z.string().email(),
        password: z.string().min(12),
        hospitalId: z.string().trim().min(1).max(100),
        hospitalName: z.string().trim().min(2).max(200)
      }).parse(req.body);
      const user = await db.bootstrapAdmin(input);
      res.status(201).json({ token: issueToken(user, config.jwtSecret) });
    } catch (error) { next(error); }
  });

  const staff = requireAuth(
    config.jwtSecret,
    ["receptionist", "hospital_staff", "doctor", "reviewer", "administrator"],
    { loadUser: db.getUserForAuth }
  );
  const admin = requireAuth(
    config.jwtSecret,
    ["administrator"],
    { loadUser: db.getUserForAuth }
  );
  const registrar = requireAuth(
    config.jwtSecret,
    ["administrator", "hospital_staff"],
    { loadUser: db.getUserForAuth }
  );
  const reviewer = requireAuth(
    config.jwtSecret,
    ["reviewer", "administrator"],
    { loadUser: db.getUserForAuth }
  );

  app.post("/auth/password", passwordRateLimit, staff, async (req, res, next) => {
    try {
      const currentPassword = req.body?.currentPassword;
      const newPassword = req.body?.newPassword;
      const message = passwordChangeMessage(currentPassword, newPassword);
      if (message) return res.status(400).json({ error: message });
      await db.changePassword(req.user.sub, currentPassword, newPassword);
      res.json({ status: "password_updated" });
    } catch (error) { next(error); }
  });

  app.post("/patient-registration/wallet-challenge", authRateLimit, staff, async (req, res, next) => {
    try {
      const walletAddress = getAddress(z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/).parse(req.body?.walletAddress));
      if (walletAddress === ZERO_ADDRESS) return res.status(400).json({ error: "A patient wallet is required." });
      const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const message = ["MedChain Patient Wallet Link", `Wallet: ${walletAddress}`, `Nonce: ${nonce}`, `Expires: ${expiresAt}`].join("\n");
      await db.createRegistrationWalletChallenge({ walletAddress: walletAddress.toLowerCase(), nonce, message, expiresAt });
      res.json({ nonce, message, expiresAt });
    } catch (error) { next(error); }
  });

  app.post("/patients/match", staff, async (req, res, next) => {
    try {
      const profile = profileSchema.parse(req.body);
      const result = await db.matchPatient(profile, req.user.hospital_id);
      if (result.status === "possible_match") {
        const review = await db.createReviewCase(profile, db.identityHashes(profile), result.candidates, req.user.sub, req.user.hospital_id);
        return res.status(202).json({ status: "review_required", reviewCaseId: review.id, candidateCount: result.candidateCount });
      }
      res.json(result.status === "high_confidence"
        ? { status: result.status, patient: result.patient }
        : { status: result.status, candidateCount: result.candidateCount });
    } catch (error) { next(error); }
  });

  app.post("/patients", registrar, async (req, res, next) => {
    try {
      const profile = profileSchema.parse(req.body);
      const reviewCaseId = req.body.reviewCaseId
        ? z.string().uuid().parse(req.body.reviewCaseId)
        : null;
      const hashes = db.identityHashes(profile);
      const match = await db.matchPatient(profile, req.user.hospital_id);
      if (match.status === "high_confidence") {
        return res.status(200).json({ status: "existing_patient", patientId: match.patient.patient_id });
      }
      if (match.status === "possible_match") {
        const review = await db.createReviewCase(profile, hashes, match.candidates, req.user.sub, req.user.hospital_id);
        return res.status(202).json({ status: "review_required", reviewCaseId: review.id, candidateCount: match.candidateCount });
      }
      // Stop before pending patients, registration rows, and submission audits.
      if (config.blockchainEnabled === false) {
        return res.status(503).json({ error: "Blockchain registration is unavailable" });
      }
      const requestedOwnership = readPatientOwnership(req.body);
      const commitment = blockchain.identityCommitment(JSON.stringify(hashes), config.identityCommitmentKey);
      if (typeof blockchain.verifySigner === "function") {
        try {
          const signer = await blockchain.verifySigner();
          if (!signer?.isHospitalAdmin) {
            return res.status(403).json({ error: "The signing account cannot register patients." });
          }
        } catch (error) {
          return res.status(503).json({ error: "Blockchain registration is unavailable" });
        }
      }
      if (!reviewCaseId && typeof db.findRegistrationByCommitment === "function") {
        const prior = await db.findRegistrationByCommitment(commitment, req.user.hospital_id);
        if (prior && prior.status === "failed" && !prior.txHash) {
          return res.status(409).json({ error: DUPLICATE_COMMITMENT_MESSAGE });
        }
        if (prior && prior.status === "unknown" && prior.txHash) {
          return res.status(202).json({ status: "registration_reconciliation_required" });
        }
      }
      const recovered = !reviewCaseId && db.getPendingRegistrationByCommitment
        ? await db.getPendingRegistrationByCommitment(commitment, req.user.hospital_id)
        : null;
      const pending = reviewCaseId
        ? await db.getReviewRegistration(reviewCaseId, req.user.hospital_id)
        : recovered || await db.createPendingPatient(profile, hashes, req.user.sub, req.user.hospital_id);
      let registration = await db.beginRegistration(pending.id, req.user.hospital_id, requestedOwnership.storedController, commitment);
      const ownership = ownershipFromRegistration(registration, requestedOwnership);
      if (registration.duplicateConflict) {
        if (typeof db.closeRejectedRegistration === "function") await db.closeRejectedRegistration(pending.id, req.user.hospital_id);
        return res.status(409).json({ error: DUPLICATE_COMMITMENT_MESSAGE });
      }
      if (registration.status === "confirmed") {
        return res.status(200).json({ status: "confirmed", patientId: registration.patientId, did: registration.did, transaction: registration.txHash });
      }
      if (registration.status === "submitted" && registration.txHash) {
        const reconciled = await blockchain.reconcileRegistration(registration.txHash);
        if (reconciled.status === "pending") {
          return res.status(202).json({ status: "registration_pending" });
        }
        registration = await db.markRegistrationResult(registration.id, reconciled);
        if (reconciled.status === "failed") {
          return res.status(502).json({ status: "registration_failed" });
        }
      } else {
        if (registration.status === "submitting" && !registration.claimed) {
          return res.status(202).json({ status: "registration_submission_in_progress" });
        }
        if (registration.status === "unknown" && await blockchain.commitmentExists(commitment)) {
          if (!registration.txHash) {
            await db.markRegistrationResult(registration.id, { status: "failed", error: "duplicate identity commitment" });
            if (typeof db.closeRejectedRegistration === "function") await db.closeRejectedRegistration(pending.id, req.user.hospital_id);
            return res.status(409).json({ error: DUPLICATE_COMMITMENT_MESSAGE });
          }
          return res.status(202).json({ status: "registration_reconciliation_required" });
        }
        if (ownership.controller !== ZERO_ADDRESS && typeof db.consumeRegistrationWalletChallenge === "function") {
          const nonce = typeof req.body?.walletProof?.nonce === "string" ? req.body.walletProof.nonce.trim().toLowerCase() : "";
          const signature = typeof req.body?.walletProof?.signature === "string" ? req.body.walletProof.signature.trim() : "";
          if (!/^0x[0-9a-f]{64}$/.test(nonce) || !/^0x[0-9a-f]+$/i.test(signature)) {
            return res.status(400).json({ error: "The patient wallet must sign the link before registration." });
          }
          const challenge = await db.consumeRegistrationWalletChallenge(nonce);
          let signer = "";
          try { signer = getAddress(verifyMessage(challenge?.message || "", signature)).toLowerCase(); } catch { signer = ""; }
          if (!challenge || signer !== ownership.controller.toLowerCase() || signer !== challenge.walletAddress) {
            return res.status(400).json({ error: "The wallet signature could not be verified." });
          }
        }
        let submitted;
        try {
          const patientRef = `0x${crypto.randomBytes(32).toString("hex")}`;
          submitted = await blockchain.submitRegistration(patientRef, ownership.controller, commitment, ownership.claimCommitment);
        } catch (error) {
          if (error.statusCode === 409) {
            await db.markRegistrationResult(registration.id, { status: "failed", error: "duplicate identity commitment" });
            if (typeof db.closeRejectedRegistration === "function") await db.closeRejectedRegistration(pending.id, req.user.hospital_id);
            return res.status(409).json({ error: DUPLICATE_COMMITMENT_MESSAGE });
          }
          await db.markRegistrationResult(registration.id, {
            status: "unknown",
            error: "RPC submission outcome is uncertain"
          });
          return res.status(202).json({ status: "registration_reconciliation_required" });
        }
        await db.markRegistrationSubmitted(registration.id, submitted.txHash);
        return res.status(202).json({ status: "registration_submitted", transaction: submitted.txHash });
      }
      const chain = {
        allocatePublicId: true,
        patientRef: registration.chainPatientId,
        patientId: registration.chainPatientId,
        controller: registration.controller || ownership.storedController,
        did: registration.chainDid,
        txHash: registration.txHash
      };
      const patient = await db.confirmPatient(pending.id, chain, req.user.sub, req.user.hospital_id);
      res.status(201).json({ patientId: patient.patientId, did: patient.did, transaction: patient.txHash });
    } catch (error) { next(error); }
  });

  app.get("/patients/:patientId", staff, async (req, res, next) => {
    try {
      const patient = await db.getPatient(req.params.patientId, req.user.hospital_id);
      if (!patient) return res.status(404).json({ error: "Patient not found" });
      res.json(patient);
    } catch (error) { next(error); }
  });

  app.post("/patients/:patientId/visits", staff, async (req, res, next) => {
    try {
      const input = z.object({ recordReference: z.string().trim().min(1).max(200), recordHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() }).parse(req.body);
      const visit = await db.createVisit(req.params.patientId, input, req.user.sub, req.user.hospital_id);
      res.status(201).json({ visitId: visit.id, patientId: req.params.patientId });
    } catch (error) { next(error); }
  });

  app.post("/review-cases/:id/decision", reviewer, async (req, res, next) => {
    try {
      const input = z.object({
        decision: z.enum(["same_patient", "different_person", "reject"]),
        candidatePatientId: z.string().uuid().optional(),
        notes: z.string().trim().max(1000).optional()
      }).parse(req.body);
      // different_person moves the review patient to pending so it can be registered on-chain.
      if (config.blockchainEnabled === false && input.decision === "different_person") {
        return res.status(503).json({ error: "Blockchain registration is unavailable" });
      }
      const result = await db.resolveReviewCase(req.params.id, input, req.user.sub, req.user.hospital_id);
      res.json({ status: result.status, patientId: result.linkedPatientId || undefined, registrationRequired: result.status === "resolved_different" });
    } catch (error) { next(error); }
  });

  app.get("/review-cases", reviewer, async (req, res, next) => {
    try { res.json({ cases: await db.listReviewCases(req.user.hospital_id) }); } catch (error) { next(error); }
  });

  app.get("/review-cases/:id", reviewer, async (req, res, next) => {
    try {
      const review = await db.getReviewCase(req.params.id, req.user.hospital_id);
      if (!review) return res.status(404).json({ error: "Review case not found" });
      res.json(review);
    } catch (error) { next(error); }
  });

  app.get("/admin/users", admin, async (req, res, next) => {
    try {
      res.json({ users: await db.listUsers(req.user.hospital_id) });
    } catch (error) { next(error); }
  });

  app.post("/admin/staff-wallet/challenge", authRateLimit, admin, async (req, res, next) => {
    try {
      const input = z.object({
        fullName: z.string().trim().min(2).max(200),
        email: z.string().trim().email().max(320),
        role: z.enum(["doctor", "hospital_staff"]),
        chainRole: z.string().trim().optional(),
        walletAddress: z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/)
      }).parse(req.body);
      const walletAddress = getAddress(input.walletAddress);
      const chainRole = chainRoleFor(input.role, input.chainRole);
      if (typeof blockchain.hospitalSigner === "function") {
        const signer = await blockchain.hospitalSigner();
        if (getAddress(signer) === walletAddress) {
          return res.status(400).json({ error: "The hospital administrator wallet cannot be the staff wallet." });
        }
      }
      const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const message = staffWalletMessage({
        fullName: input.fullName,
        email: input.email.toLowerCase(),
        role: input.role,
        chainRole,
        walletAddress,
        nonce,
        expiresAt
      });
      await db.createStaffWalletChallenge({ walletAddress: walletAddress.toLowerCase(), nonce, message, expiresAt });
      res.json({ nonce, message, expiresAt, chainRole });
    } catch (error) { next(error); }
  });

  async function verifiedStaffWallet({ fullName, email, role, chainRole, walletProof }) {
    const nonce = typeof walletProof?.nonce === "string" ? walletProof.nonce.trim().toLowerCase() : "";
    const signature = typeof walletProof?.signature === "string" ? walletProof.signature.trim() : "";
    if (!/^0x[0-9a-f]{64}$/.test(nonce) || !/^0x[0-9a-f]+$/i.test(signature) || typeof db.consumeStaffWalletChallenge !== "function") {
      const error = new Error(WALLET_REQUIRED);
      error.statusCode = 400;
      throw error;
    }
    const challenge = await db.consumeStaffWalletChallenge(nonce);
    let signer = "";
    try { signer = getAddress(verifyMessage(challenge?.message || "", signature)).toLowerCase(); } catch { signer = ""; }
    const walletAddress = getAddress(signer || "0x0000000000000000000000000000000000000000");
    if (!challenge || signer !== challenge.walletAddress || !messageMatches(challenge.message, {
      fullName,
      email: email.toLowerCase(),
      role,
      chainRole,
      walletAddress
    })) {
      const error = new Error("The wallet signature could not be verified.");
      error.statusCode = 400;
      throw error;
    }
    return signer;
  }

  app.post("/admin/users", admin, async (req, res, next) => {
    try {
      const input = z.object({
        fullName: z.string().trim().min(2).max(200),
        email: z.string().trim().email().max(320),
        password: z.string().min(12),
        role: z.enum(["receptionist", "doctor", "reviewer", "hospital_staff"]),
        chainRole: z.string().trim().optional(),
        walletProof: z.object({ nonce: z.string(), signature: z.string() }).optional()
      }).parse(req.body);
      const chainRole = chainRoleFor(input.role, input.chainRole);
      let authorization = null;
      if (isClinicalRole(input.role)) {
        const walletAddress = await verifiedStaffWallet({ ...input, chainRole });
        authorization = { walletAddress, chainRole };
      }
      const user = await db.createUser({ ...input, hospitalId: req.user.hospital_id, authorization });
      res.status(201).json({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
        authorization: user.authorization || null
      });
    } catch (error) { next(error); }
  });

  app.post("/admin/users/:id/authorization", admin, async (req, res, next) => {
    try {
      const input = z.object({
        fullName: z.string().trim().min(2).max(200).optional(),
        chainRole: z.string().trim().optional(),
        walletProof: z.object({ nonce: z.string(), signature: z.string() }).optional()
      }).parse(req.body);
      const member = await db.getStaffMember(req.params.id, req.user.hospital_id);
      if (!member || member.role === "administrator") return res.status(404).json({ error: "User not found" });
      const fullName = input.fullName || member.fullName;
      if (!fullName) return res.status(400).json({ error: "Enter the staff member's name." });
      if (input.fullName && input.fullName !== member.fullName) await db.updateStaffName(member.id, req.user.hospital_id, input.fullName);
      member.fullName = fullName;
      const chainRole = chainRoleFor(member.role, input.chainRole || member.chainRole);
      if (!isClinicalRole(member.role)) return res.status(400).json({ error: "This role does not use a blockchain wallet." });
      const walletAddress = input.walletProof
        ? await verifiedStaffWallet({ fullName: member.fullName, email: member.email, role: member.role, chainRole, walletProof: input.walletProof })
        : member.walletAddress;
      if (!walletAddress) return res.status(400).json({ error: WALLET_REQUIRED });
      await db.saveStaffAuthorization({
        userId: member.id,
        hospitalId: req.user.hospital_id,
        walletAddress,
        chainRole,
        previousChainRole: member.chainRole && member.chainRole !== chainRole ? member.chainRole : member.previousChainRole,
        previousWalletAddress: member.walletAddress && member.walletAddress !== walletAddress ? member.walletAddress : member.previousWalletAddress,
        action: "grant"
      });
      res.json({ id: member.id, authorization: { status: "pending", action: "grant", walletAddress, chainRole } });
    } catch (error) { next(error); }
  });

  app.post("/admin/users/:id/authorization/result", admin, async (req, res, next) => {
    try {
      const input = z.object({
        status: z.enum(["failed", "submitted"]),
        txHash: z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/).optional()
      }).parse(req.body);
      if (input.status === "submitted" && !input.txHash) return res.status(400).json({ error: "Invalid request" });
      const stored = input.status === "submitted" ? "pending" : "failed";
      await db.markStaffAuthorization(req.params.id, req.user.hospital_id, stored, input.txHash);
      res.json({ status: stored });
    } catch (error) { next(error); }
  });

  app.post("/admin/users/:id/authorization/verify", admin, async (req, res, next) => {
    try {
      const member = await db.getStaffMember(req.params.id, req.user.hospital_id);
      if (!member?.walletAddress || !member.chainRole) return res.status(404).json({ error: "User not found" });
      if (typeof blockchain.hasChainRole !== "function") return res.status(503).json({ error: "Service unavailable" });
      const holds = async (role, wallet) => role && wallet ? Boolean(await blockchain.hasChainRole(role, wallet)) : false;
      const desiredHeld = await holds(member.chainRole, member.walletAddress);
      const previousRole = member.previousChainRole && member.previousChainRole !== member.chainRole ? member.previousChainRole : "";
      const previousWallet = member.previousWalletAddress && member.previousWalletAddress !== member.walletAddress ? member.previousWalletAddress : "";
      const previousHeld = await holds(previousRole, previousWallet || member.walletAddress);
      const previousWalletHeld = previousWallet ? await holds(member.chainRole, previousWallet) : false;
      const clearing = member.authorizationAction === "revoke" || member.status === "disabled" || !isClinicalRole(member.role);
      const matches = clearing ? !desiredHeld && !previousHeld : desiredHeld && !previousHeld && !previousWalletHeld;
      if (!matches) return res.json({ status: member.authorizationStatus || "pending", verified: false });
      if (clearing) {
        await db.clearStaffAuthorization(member.id, req.user.hospital_id);
        return res.json({ status: "active", verified: true, cleared: true });
      }
      await db.markStaffAuthorization(member.id, req.user.hospital_id, "active", member.authorizationTx);
      res.json({ status: "active", verified: true });
    } catch (error) { next(error); }
  });

  app.post("/admin/users/:id/role", admin, async (req, res, next) => {
    try {
      const input = z.object({
        role: z.enum(["receptionist", "doctor", "reviewer", "hospital_staff"]),
        chainRole: z.string().trim().optional(),
        walletProof: z.object({ nonce: z.string(), signature: z.string() }).optional()
      }).parse(req.body);
      if (req.params.id === req.user.sub) return res.status(400).json({ error: "This role cannot be granted on the blockchain." });
      const member = await db.getStaffMember(req.params.id, req.user.hospital_id);
      if (!member || member.role === "administrator") return res.status(404).json({ error: "User not found" });
      const chainRole = chainRoleFor(input.role, input.chainRole);
      let authorization = null;
      if (isClinicalRole(input.role)) {
        const walletAddress = input.walletProof
          ? await verifiedStaffWallet({ fullName: member.fullName, email: member.email, role: input.role, chainRole, walletProof: input.walletProof })
          : member.walletAddress;
        if (!walletAddress) return res.status(400).json({ error: WALLET_REQUIRED });
        authorization = {
          walletAddress,
          chainRole,
          previousChainRole: member.chainRole && member.chainRole !== chainRole ? member.chainRole : null,
          previousWalletAddress: member.walletAddress && member.walletAddress !== walletAddress ? member.walletAddress : null,
          action: "grant"
        };
      } else if (member.chainRole && member.walletAddress) {
        authorization = {
          walletAddress: member.walletAddress,
          chainRole: member.chainRole,
          action: "revoke"
        };
      }
      const user = await db.changeStaffRole({ userId: member.id, hospitalId: req.user.hospital_id, role: input.role, authorization });
      res.json({ id: user.id, role: user.role, authorization: authorization ? { status: "pending", action: authorization.action, chainRole: authorization.chainRole, walletAddress: authorization.walletAddress } : null });
    } catch (error) { next(error); }
  });

  registerPatientAuth(app, { db, blockchain, config, authRateLimit: patientAuthRateLimit() });
  registerClinicalRecords(app, { db, blockchain, config, authRateLimit });
  registerNursing(app, { db, blockchain, config });

  app.post("/admin/users/:id/disable", admin, async (req, res, next) => {
    try {
      await db.disableUser(req.params.id, req.user.sub, req.user.hospital_id);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.use((error, _req, res, _next) => {
    if (error.name === "ZodError") return res.status(400).json({ error: "Invalid request" });
    const publicError = error.code === "23505" && error.constraint === "users_email_key"
      ? Object.assign(new Error("A staff account with this email already exists."), { statusCode: 409 })
      : error.code === "23505" && error.constraint === "staff_chain_authorizations_wallet_key"
        ? Object.assign(new Error("This wallet is already linked to a staff account."), { statusCode: 409 })
        : error;
    const publicStatus = [400, 401, 403, 404, 409].includes(publicError.statusCode) ? publicError.statusCode : publicError.statusCode === 503 ? 503 : 500;
    const publicMessage = publicStatus === 503 ? "Service unavailable" : publicStatus === 500 ? "Internal server error" : publicError.message;
    if (publicStatus >= 500) console.error("request failed");
    else console.error("request rejected", publicStatus);
    res.status(publicStatus).json({ error: publicMessage });
  });
  return app;
}

module.exports = { createApp, profileSchema };
