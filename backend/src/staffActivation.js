const crypto = require("node:crypto");
const { getAddress } = require("ethers");
const { fieldHash } = require("./crypto");
const { recordActivity } = require("./activityAudit");
const {
  CHAIN_ROLES,
  NON_CLINICAL_WALLET,
  httpError,
  isClinicalRole,
  staffWalletMessage
} = require("./staffAuthorization");

const ACTIVATION_REJECTED = "The activation code was not accepted.";
const ACTIVATION_EXPIRED = "This activation code has expired. Ask the hospital administrator for a new code.";
const ACTIVATION_USED = "This activation code has already been used.";
const ACTIVATION_LOCKED = "Too many activation attempts. Ask the hospital administrator for a new code.";
const WALLET_CONNECT = "Connect the staff wallet before activating this account.";
const PATIENT_WALLET = "This wallet belongs to a patient record and cannot be a staff wallet.";
const INCOMPATIBLE_WALLET = "This wallet cannot be used for this staff role.";
const ADMIN_WALLET = "The hospital administrator wallet cannot be the staff wallet.";
const DUPLICATE_WALLET = "This wallet is already linked to a staff account.";
const ALREADY_ACTIVE = "This account is already activated.";

const OUTCOMES = {
  invalid: ACTIVATION_REJECTED,
  expired: ACTIVATION_EXPIRED,
  used: ACTIVATION_USED,
  locked: ACTIVATION_LOCKED
};

function normalizeActivationCode(code) {
  return String(code || "").toLowerCase().replace(/[^a-f0-9]/g, "");
}

function createActivationCode() {
  return crypto.randomBytes(16).toString("hex").match(/.{4}/g).join("-");
}

function hashActivationCode(code, secret) {
  const normalized = normalizeActivationCode(code);
  if (!/^[a-f0-9]{32}$/.test(normalized) || !secret) return "";
  return fieldHash(secret, "staff-activation", normalized);
}

function activationLifetimeMs(config) {
  const hours = Number(config?.staffActivationHours);
  const chosen = Number.isFinite(hours) && hours > 0 && hours <= 168 ? hours : 24;
  return chosen * 60 * 60 * 1000;
}

function activationExpiry(config) {
  return new Date(Date.now() + activationLifetimeMs(config)).toISOString();
}

function registerStaffActivation(app, { db, blockchain, config, authRateLimit, admin, verifyWallet }) {
  const limit = authRateLimit || ((_req, _res, next) => next());

  async function notedFailure(result) {
    if (!result?.userId) return;
    await recordActivity(db, {
      actorId: result.userId,
      actorRole: result.role || null,
      hospitalId: result.hospitalId || null,
      action: "ACTIVATION_FAILED",
      category: "security",
      outcome: "failure",
      resourceId: result.userId,
      metadata: { reason: result.outcome }
    }).catch(() => {});
  }

  async function rejectUnusableWallet(wallet, assignedRole) {
    if (typeof blockchain.hospitalSigner === "function") {
      const signer = await blockchain.hospitalSigner();
      if (getAddress(signer) === getAddress(wallet)) throw httpError(ADMIN_WALLET, 400);
    }
    if (typeof db.walletUsedByPatient === "function" && await db.walletUsedByPatient(wallet)) {
      throw httpError(PATIENT_WALLET, 400);
    }
    if (typeof db.walletUsedByStaff === "function" && await db.walletUsedByStaff(wallet)) {
      throw httpError(DUPLICATE_WALLET, 409);
    }
    if (typeof blockchain.hasChainRole !== "function") return;
    for (const role of CHAIN_ROLES) {
      if (role === assignedRole) continue;
      let held = false;
      try {
        held = Boolean(await blockchain.hasChainRole(role, wallet));
      } catch (error) {
        console.error("staff activation chain check failed", error?.code || error?.name || "Error");
        throw httpError("Service unavailable", 503);
      }
      if (held) throw httpError(INCOMPATIBLE_WALLET, 400);
    }
  }

  app.post("/auth/staff-activation/wallet-challenge", limit, async (req, res, next) => {
    try {
      const email = String(req.body?.email || "");
      const codeHash = hashActivationCode(req.body?.activationCode, config.identityCommitmentKey);
      const suppliedWallet = String(req.body?.walletAddress || "");
      if (!/^0x[0-9a-fA-F]{40}$/.test(suppliedWallet)) return res.status(400).json({ error: WALLET_CONNECT });
      const walletAddress = getAddress(suppliedWallet);
      const found = await db.readStaffActivation(email, codeHash);
      if (found.outcome !== "ready") {
        await notedFailure(found);
        return res.status(400).json({ error: OUTCOMES[found.outcome] || ACTIVATION_REJECTED });
      }
      if (!isClinicalRole(found.user.role)) return res.status(400).json({ error: NON_CLINICAL_WALLET });
      const chainRole = found.user.chainRole;
      if (!CHAIN_ROLES.includes(chainRole)) return res.status(400).json({ error: INCOMPATIBLE_WALLET });
      await rejectUnusableWallet(walletAddress, chainRole);
      const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const message = staffWalletMessage({
        fullName: found.user.fullName,
        email: found.user.email,
        role: found.user.role,
        chainRole,
        walletAddress,
        nonce,
        expiresAt
      });
      await db.createStaffWalletChallenge({ walletAddress: walletAddress.toLowerCase(), nonce, message, expiresAt });
      res.json({ nonce, message, expiresAt, chainRole });
    } catch (error) { next(error); }
  });

  app.post("/auth/staff-activation", limit, async (req, res, next) => {
    try {
      const email = String(req.body?.email || "");
      const password = String(req.body?.password || "");
      const codeHash = hashActivationCode(req.body?.activationCode, config.identityCommitmentKey);
      if (password.length < 12 || password.length > 200) return res.status(400).json({ error: "Use at least 12 characters." });
      const found = await db.readStaffActivation(email, codeHash);
      if (found.outcome !== "ready") {
        await notedFailure(found);
        return res.status(400).json({ error: OUTCOMES[found.outcome] || ACTIVATION_REJECTED });
      }
      const clinical = isClinicalRole(found.user.role);
      const proof = req.body?.walletProof;
      if (clinical && !proof) return res.status(400).json({ error: WALLET_CONNECT });
      if (!clinical && proof) return res.status(400).json({ error: NON_CLINICAL_WALLET });
      let walletAddress = "";
      if (clinical) {
        walletAddress = await verifyWallet({
          fullName: found.user.fullName,
          email: found.user.email,
          role: found.user.role,
          chainRole: found.user.chainRole,
          walletProof: proof
        });
        await rejectUnusableWallet(walletAddress, found.user.chainRole);
      }
      const completed = await db.completeStaffActivation({
        userId: found.user.id,
        hospitalId: found.user.hospitalId,
        codeHash,
        password,
        walletAddress
      });
      if (completed.outcome !== "activated") {
        await notedFailure({ ...found, ...completed, outcome: completed.outcome, userId: found.user.id, hospitalId: found.user.hospitalId, role: found.user.role });
        return res.status(400).json({ error: OUTCOMES[completed.outcome] || ACTIVATION_REJECTED });
      }
      await recordActivity(db, {
        actorId: completed.user.id,
        actorRole: completed.user.role,
        hospitalId: completed.user.hospital_id,
        action: "ACCOUNT_ACTIVATED",
        category: "security",
        outcome: "success",
        resourceId: completed.user.id,
        metadata: { role: completed.user.role }
      }).catch(() => {});
      if (completed.authorization?.walletAddress) {
        await recordActivity(db, {
          actorId: completed.user.id,
          actorRole: completed.user.role,
          hospitalId: completed.user.hospital_id,
          action: "WALLET_VERIFIED",
          category: "security",
          outcome: "success",
          resourceId: completed.user.id,
          metadata: { role: completed.user.role }
        }).catch(() => {});
      }
      res.json({
        status: completed.user.status,
        role: completed.user.role,
        walletVerified: Boolean(completed.authorization?.walletAddress),
        authorization: completed.authorization ? { status: "pending", chainRole: completed.authorization.chainRole } : null
      });
    } catch (error) { next(error); }
  });

  app.post("/admin/users/:id/activation-code", admin, async (req, res, next) => {
    try {
      const code = createActivationCode();
      const expiresAt = activationExpiry(config);
      const issued = await db.reissueStaffActivation({
        userId: req.params.id,
        hospitalId: req.user.hospital_id,
        codeHash: hashActivationCode(code, config.identityCommitmentKey),
        expiresAt
      });
      if (!issued) return res.status(404).json({ error: "User not found" });
      await recordActivity(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        hospitalId: req.user.hospital_id,
        action: "ACTIVATION_CODE_REGENERATED",
        category: "security",
        outcome: "success",
        resourceId: req.params.id,
        metadata: { role: issued.role || "" }
      }).catch(() => {});
      res.json({ activationCode: code, activationExpiresAt: expiresAt });
    } catch (error) { next(error); }
  });
}

module.exports = {
  ACTIVATION_EXPIRED,
  ACTIVATION_LOCKED,
  ACTIVATION_REJECTED,
  ACTIVATION_USED,
  ADMIN_WALLET,
  ALREADY_ACTIVE,
  DUPLICATE_WALLET,
  INCOMPATIBLE_WALLET,
  PATIENT_WALLET,
  WALLET_CONNECT,
  activationExpiry,
  createActivationCode,
  hashActivationCode,
  normalizeActivationCode,
  registerStaffActivation
};
