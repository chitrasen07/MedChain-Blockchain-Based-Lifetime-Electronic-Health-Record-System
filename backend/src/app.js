const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { encryptJson, decryptJson, fieldHash } = require("./crypto");
const { issueToken, requireAuth } = require("./auth");

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mobile: z.string().trim().max(40).optional(),
  email: z.string().email().max(320).optional(),
  emergencyContact: z.string().trim().max(200).optional()
});

function createApp({ db, blockchain, config }) {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "32kb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: true }));
  const authRateLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true });

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
  const reviewer = requireAuth(
    config.jwtSecret,
    ["reviewer", "administrator"],
    { loadUser: db.getUserForAuth }
  );

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

  app.post("/patients", admin, async (req, res, next) => {
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
      const commitment = blockchain.identityCommitment(JSON.stringify(hashes), config.identityCommitmentKey);
      const recovered = !reviewCaseId && db.getPendingRegistrationByCommitment
        ? await db.getPendingRegistrationByCommitment(commitment, req.user.hospital_id)
        : null;
      const pending = reviewCaseId
        ? await db.getReviewRegistration(reviewCaseId, req.user.hospital_id)
        : recovered || await db.createPendingPatient(profile, hashes, req.user.sub, req.user.hospital_id);
      let registration = await db.beginRegistration(pending.id, req.user.hospital_id, config.controllerAddress, commitment);
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
          return res.status(202).json({ status: "registration_reconciliation_required" });
        }
        let submitted;
        try {
          submitted = await blockchain.submitRegistration(config.controllerAddress, commitment);
        } catch (error) {
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
        patientId: registration.chainPatientId,
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

  app.post("/admin/users", admin, async (req, res, next) => {
    try {
      const input = z.object({
        email: z.string().email(),
        password: z.string().min(12),
        role: z.enum(["receptionist", "doctor", "reviewer", "hospital_staff"])
      }).parse(req.body);
      const user = await db.createUser({ ...input, hospitalId: req.user.hospital_id });
      res.status(201).json({ id: user.id, email: user.email, role: user.role, status: user.status });
    } catch (error) { next(error); }
  });

  app.post("/admin/users/:id/disable", admin, async (req, res, next) => {
    try {
      await db.disableUser(req.params.id, req.user.sub, req.user.hospital_id);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.use((error, _req, res, _next) => {
    if (error.name === "ZodError") return res.status(400).json({ error: "Invalid request" });
    console.error("request failed", error.message);
    const publicStatus = [401, 403, 404].includes(error.statusCode) ? error.statusCode : error.statusCode === 503 ? 503 : 500;
    const publicMessage = publicStatus === 503 ? "Service unavailable" : publicStatus === 500 ? "Internal server error" : error.message;
    res.status(publicStatus).json({ error: publicMessage });
  });
  return app;
}

module.exports = { createApp, profileSchema };
