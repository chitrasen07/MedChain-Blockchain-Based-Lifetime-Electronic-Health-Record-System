const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");

const secret = "test-secret-that-is-long-enough";
const admin = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
const profile = { fullName: "Synthetic Patient", dateOfBirth: "1990-01-01" };

function appFor() {
  const calls = [];
  const challenges = new Map();
  const db = {
    async getUserForAuth(id) { return id === admin.id ? admin : null; },
    identityHashes() { return [["fullName", "synthetic-hash"]]; },
    async matchPatient() { return { status: "no_match", candidates: [], candidateCount: 0 }; },
    async createPendingPatient() { calls.push("createPendingPatient"); return { id: "patient-row-1" }; },
    async getPendingRegistrationByCommitment() { return null; },
    async beginRegistration() { return { id: "registration-1", status: "unknown", claimed: true }; },
    async markRegistrationSubmitted() { calls.push("markRegistrationSubmitted"); },
    async markRegistrationResult() { calls.push("markRegistrationResult"); },
    async createRegistrationWalletChallenge(input) { challenges.set(input.nonce, { ...input, used: false }); },
    async consumeRegistrationWalletChallenge(nonce) {
      const row = challenges.get(nonce);
      if (!row || row.used) return null;
      row.used = true;
      return { walletAddress: row.walletAddress, message: row.message };
    }
  };
  const blockchain = {
    identityCommitment() { return `0x${"11".repeat(32)}`; },
    async submitRegistration() { calls.push("submitRegistration"); return { txHash: "0xtx1" }; },
    async commitmentExists() { return false; },
    async verifySigner() { return { isHospitalAdmin: true }; }
  };
  return {
    app: createApp({
      db,
      blockchain,
      config: { corsOrigin: false, jwtSecret: secret, identityCommitmentKey: "synthetic", blockchainEnabled: true }
    }),
    calls
  };
}

test("the deployed claim delay stays a one-hour constant", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../blockchain/contracts/PatientRegistry.sol"), "utf8");
  assert.match(source, /uint256 public constant CLAIM_DELAY = 1 hours;/);
});

test("wallet registration requires one signed link and does not submit without it", async () => {
  const wallet = Wallet.createRandom();
  const { app, calls } = appFor();
  const token = issueToken(admin, secret);
  const unsigned = await request(app).post("/patients").set("Authorization", `Bearer ${token}`).send({
    ...profile,
    controller: wallet.address
  });
  assert.equal(unsigned.status, 400);
  assert.equal(unsigned.body.error, "The patient wallet must sign the link before registration.");
  assert.equal(calls.includes("submitRegistration"), false);

  const challenge = await request(app).post("/patient-registration/wallet-challenge").set("Authorization", `Bearer ${token}`).send({
    walletAddress: wallet.address
  });
  assert.equal(challenge.status, 200);
  assert.match(challenge.body.message, /^MedChain Patient Wallet Link/);
  const signature = await wallet.signMessage(challenge.body.message);
  const registered = await request(app).post("/patients").set("Authorization", `Bearer ${token}`).send({
    ...profile,
    controller: wallet.address,
    walletProof: { nonce: challenge.body.nonce, signature }
  });
  assert.equal(registered.status, 202);
  assert.equal(calls.includes("submitRegistration"), true);

  const replay = await request(app).post("/patients").set("Authorization", `Bearer ${token}`).send({
    ...profile,
    controller: wallet.address,
    walletProof: { nonce: challenge.body.nonce, signature }
  });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, "The wallet signature could not be verified.");
});
