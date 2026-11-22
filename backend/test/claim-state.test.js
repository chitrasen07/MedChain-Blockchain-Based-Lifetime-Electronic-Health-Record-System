const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { describeClaimState } = require("../src/patientAuth");
const { decodeClaimSlot, claimAnnouncementFromStorage } = require("../src/claimState");

const secret = "test-secret-that-is-long-enough";
const ZERO = "0x0000000000000000000000000000000000000000";
const ref = `0x${"ab".repeat(32)}`;
const claim = `0x${"12".repeat(32)}`;
const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = `0x${"44".repeat(32)}`;

test("claim timing follows the chain announcement instead of browser memory", () => {
  const waiting = describeClaimState({
    controller: ZERO,
    walletAddress: wallet,
    announcement: { announced: true, claimant: wallet, announcedAt: 1_000, pendingClaimHash: hash },
    sealedClaim: hash,
    delaySeconds: 3600,
    windowSeconds: 86400,
    now: 1_000
  });
  assert.equal(waiting.onChainClaim, "announced");
  assert.equal(waiting.canAnnounce, false);
  assert.equal(waiting.canReveal, false);
  assert.equal(waiting.remainingSeconds, 3600);
  assert.match(waiting.message, /Do not announce again/);

  const ready = describeClaimState({
    controller: ZERO,
    walletAddress: wallet,
    announcement: { announced: true, claimant: wallet, announcedAt: 1_000, pendingClaimHash: hash },
    sealedClaim: hash,
    delaySeconds: 3600,
    windowSeconds: 86400,
    now: 5_000
  });
  assert.equal(ready.onChainClaim, "ready");
  assert.equal(ready.canReveal, true);
  assert.equal(ready.canAnnounce, false);

  const wrong = describeClaimState({
    controller: ZERO,
    walletAddress: other,
    announcement: { announced: true, claimant: wallet, announcedAt: 1_000, pendingClaimHash: hash },
    delaySeconds: 3600,
    windowSeconds: 86400,
    now: 5_000
  });
  assert.equal(wrong.onChainClaim, "wrong_wallet");
  assert.equal(wrong.canReveal, false);
  assert.equal(wrong.canAnnounce, false);

  const mismatch = describeClaimState({
    controller: ZERO,
    walletAddress: wallet,
    announcement: { announced: true, claimant: wallet, announcedAt: 1_000, pendingClaimHash: hash },
    sealedClaim: `0x${"55".repeat(32)}`,
    delaySeconds: 3600,
    windowSeconds: 86400,
    now: 5_000
  });
  assert.equal(mismatch.onChainClaim, "mismatch");
  assert.equal(mismatch.canReveal, false);
  assert.match(mismatch.message, /restarts the one-hour/);

  const linked = describeClaimState({ controller: wallet, walletAddress: wallet });
  assert.equal(linked.onChainClaim, "complete");
  assert.match(linked.message, /sign in/i);
});

test("packed claim storage exposes the announcement timestamp", () => {
  const announcedAt = 1_700_000_000;
  const word = (BigInt(announcedAt) << 64n) | (1n << 200n);
  const decoded = decodeClaimSlot(word);
  assert.equal(decoded.claimAnnouncedAt, announcedAt);
  assert.equal(decoded.exists, true);
  const announcement = claimAnnouncementFromStorage({
    claimantWord: wallet,
    packedWord: word,
    pendingHashWord: hash
  });
  assert.equal(announcement.announced, true);
  assert.equal(announcement.announcedAt, announcedAt);
  assert.equal(announcement.claimant.toLowerCase(), wallet.toLowerCase());
  assert.equal(announcement.pendingClaimHash, hash);
});

test("claim status reports a confirmed announce instead of saying nothing was submitted", async () => {
  const signer = Wallet.createRandom();
  const calls = [];
  const db = {
    async findConfirmedPatientForAuth() {
      return {
        id: "patient-a",
        patientId: "PATIENT-000004",
        did: ref,
        status: "confirmed",
        registrationController: `unclaimed:${claim}`
      };
    }
  };
  const blockchain = {
    async getController() { calls.push("controller"); return ZERO; },
    async getClaimDelay() { return 3600; },
    async getClaimWindow() { return 86400; },
    async getClaimAnnouncement() {
      calls.push("announcement");
      return { announced: true, claimant: signer.address, announcedAt: 1_000, pendingClaimHash: hash };
    }
  };
  const app = createApp({ db, blockchain, config: { corsOrigin: false, jwtSecret: secret, piiEncryptionKey: "11".repeat(32) } });
  const response = await request(app).post("/patient-auth/claim-status").send({
    patientId: "PATIENT-000004",
    walletAddress: signer.address,
    claimCommitment: claim,
    sealedClaim: hash
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.onChainClaim, "ready");
  assert.equal(response.body.canAnnounce, false);
  assert.equal(response.body.canReveal, true);
  assert.equal(String(response.body.message).includes("not submitted"), false);
  assert.equal(calls.includes("announcement"), true);

  const ownership = await request(app).post("/patient-auth/ownership-status").send({
    patientId: "PATIENT-000004",
    walletAddress: signer.address
  });
  assert.equal(ownership.status, 200);
  assert.equal(ownership.body.onChainClaim, "ready");
  assert.match(ownership.body.message, /Ready to reveal/);
});
