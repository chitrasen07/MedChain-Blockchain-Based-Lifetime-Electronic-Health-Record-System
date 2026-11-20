const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createBlockchainAdapter, duplicateCommitmentConflict } = require("../src/blockchain");
const { createRuntime } = require("../src/server");
const { issueToken } = require("../src/auth");

const secret = "test-secret-that-is-long-enough";
const admin = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
const reviewer = { id: "reviewer", role: "reviewer", hospital_id: "hospital-a", status: "active" };
const profile = { fullName: "Synthetic Patient", dateOfBirth: "1990-01-01" };
const baseEnv = {
  DATABASE_URL: "postgres://medchain_app:placeholder@localhost:5432/medchain",
  JWT_SECRET: secret,
  IDENTITY_COMMITMENT_KEY: "synthetic-identity",
  PII_ENCRYPTION_KEY: "11".repeat(32)
};

function auth(user) {
  return `Bearer ${issueToken(user, secret)}`;
}

function setup(blockchainEnabled, match = { status: "no_match", candidates: [], candidateCount: 0 }) {
  const calls = [];
  const db = {
    async getUserForAuth(id) { return id === admin.id ? admin : reviewer; },
    identityHashes() { return [["fullName", "synthetic-hash"]]; },
    async matchPatient() { return match; },
    async createPendingPatient() { calls.push("createPendingPatient"); return { id: "patient-row-1" }; },
    async createReviewCase() { calls.push("createReviewCase"); return { id: "11111111-1111-4111-8111-111111111111" }; },
    async getReviewRegistration() { calls.push("getReviewRegistration"); return { id: "patient-row-1" }; },
    async getPendingRegistrationByCommitment() { calls.push("getPendingRegistrationByCommitment"); return null; },
    async beginRegistration() { calls.push("beginRegistration"); return { id: "registration-1", status: "unknown", claimed: true }; },
    async markRegistrationSubmitted() { calls.push("markRegistrationSubmitted"); },
    async resolveReviewCase() { calls.push("resolveReviewCase"); return { status: "resolved_same", linkedPatientId: "PATIENT-000001" }; },
    async createVisit() { calls.push("createVisit"); return { id: "visit-1" }; },
    async checkReady() { calls.push("checkReady"); }
  };
  const blockchain = {
    identityCommitment() { calls.push("identityCommitment"); return "0x" + "11".repeat(32); },
    async submitRegistration() { calls.push("submitRegistration"); return { txHash: "0xtx1" }; },
    async commitmentExists() { calls.push("commitmentExists"); return false; },
    async verifySigner() { calls.push("verifySigner"); return { isHospitalAdmin: true }; },
    async reconcileRegistration() { calls.push("reconcileRegistration"); }
  };
  const app = createApp({
    db,
    blockchain,
    config: { corsOrigin: false, jwtSecret: secret, identityCommitmentKey: "synthetic", blockchainEnabled }
  });
  return { app, calls };
}

test("disabled mode does not require blockchain configuration or retain a signing key", () => {
  const config = createRuntime({
    ...baseEnv,
    BLOCKCHAIN_ENABLED: "false",
    RPC_URL: "http://127.0.0.1:8545",
    PATIENT_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000002",
    BLOCKCHAIN_PRIVATE_KEY: "0x" + "ab".repeat(32),
    CONTROLLER_ADDRESS: "0x0000000000000000000000000000000000000001"
  });
  assert.equal(config.blockchainEnabled, false);
  assert.equal(config.databaseUrl, baseEnv.DATABASE_URL);
  assert.equal(config.rpcUrl, undefined);
  assert.equal(config.registryAddress, undefined);
  assert.equal(config.privateKey, undefined);
  assert.equal(config.thirdwebSecretKey, undefined);
});

test("enabled mode requires the blockchain configuration and keeps it", () => {
  assert.throws(() => createRuntime(baseEnv), /RPC_URL is required/);
  assert.throws(() => createRuntime({
    ...baseEnv,
    BLOCKCHAIN_ENABLED: "true",
    RPC_URL: "http://127.0.0.1:8545"
  }), /PATIENT_REGISTRY_ADDRESS is required/);
  assert.throws(() => createRuntime({ ...baseEnv, BLOCKCHAIN_ENABLED: "sometimes" }), /BLOCKCHAIN_ENABLED must be true or false/);
  const config = createRuntime({
    ...baseEnv,
    BLOCKCHAIN_ENABLED: "true",
    RPC_URL: "http://127.0.0.1:8545",
    PATIENT_REGISTRY_ADDRESS: "0x0000000000000000000000000000000000000002",
    BLOCKCHAIN_PRIVATE_KEY: "0x" + "ab".repeat(32),
    THIRDWEB_SECRET_KEY: "synthetic-thirdweb-secret"
  });
  assert.equal(config.blockchainEnabled, true);
  assert.equal(config.rpcUrl, "http://127.0.0.1:8545");
  assert.equal(config.registryAddress, "0x0000000000000000000000000000000000000002");
  assert.equal(config.thirdwebSecretKey, "synthetic-thirdweb-secret");
  assert.equal(config.privateKey, "0x" + "ab".repeat(32));
  assert.equal(Object.hasOwn(config, "controllerAddress"), false);
});

test("a disabled adapter does not construct a wallet and rejects chain calls", async () => {
  const adapter = createBlockchainAdapter({
    blockchainEnabled: false,
    privateKey: "not-a-private-key",
    rpcUrl: "http://127.0.0.1:9",
    registryAddress: "0x0000000000000000000000000000000000000002"
  });
  assert.equal(adapter.enabled, false);
  await assert.rejects(() => adapter.submitRegistration("0x1", "0x" + "11".repeat(32)), /Blockchain registration is unavailable/);
  await assert.rejects(() => adapter.verifySigner(), /Blockchain registration is unavailable/);
  await assert.rejects(() => adapter.getController("0x" + "11".repeat(32)), /Blockchain registration is unavailable/);
  assert.throws(() => adapter.identityCommitment("value", "secret"), /Blockchain registration is unavailable/);
});

test("a duplicate commitment conflict is distinct from an indeterminate submission error", () => {
  assert.equal(duplicateCommitmentConflict({ revert: { name: "IdentityCommitmentAlreadyExists" } }), true);
  assert.equal(duplicateCommitmentConflict({ data: "0x1234" }), false);
  assert.equal(duplicateCommitmentConflict(new Error("socket hang up")), false);
});

test("an enabled adapter without credentials fails instead of returning a stub", () => {
  assert.throws(() => createBlockchainAdapter({ blockchainEnabled: true }), /Blockchain integration is not configured/);
  assert.throws(() => createBlockchainAdapter({}), /Blockchain integration is not configured/);
});

test("disabled registration writes nothing and returns 503", async () => {
  const { app, calls } = setup(false);
  const response = await request(app).post("/patients").set("Authorization", auth(admin)).send({
    ...profile,
    reviewCaseId: "11111111-1111-4111-8111-111111111111"
  });
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: "Blockchain registration is unavailable" });
  assert.deepEqual(calls, []);
});

test("disabled mode still serves health, matching, review holds, and visits", async () => {
  const noMatch = setup(false);
  const health = await request(noMatch.app).get("/health");
  const ready = await request(noMatch.app).get("/ready");
  const matched = await request(noMatch.app).post("/patients/match").set("Authorization", auth(admin)).send(profile);
  assert.equal(health.status, 200);
  assert.equal(ready.status, 200);
  assert.equal(matched.body.status, "no_match");
  assert.deepEqual(noMatch.calls, ["checkReady"]);

  const existing = setup(false, { status: "high_confidence", patient: { patient_id: "PATIENT-000001" } });
  const existingResponse = await request(existing.app).post("/patients").set("Authorization", auth(admin)).send(profile);
  assert.equal(existingResponse.status, 200);
  assert.equal(existingResponse.body.status, "existing_patient");
  assert.deepEqual(existing.calls, []);

  const ambiguous = setup(false, { status: "possible_match", candidates: ["one"], candidateCount: 1 });
  const review = await request(ambiguous.app).post("/patients").set("Authorization", auth(admin)).send(profile);
  assert.equal(review.status, 202);
  assert.equal(review.body.status, "review_required");
  assert.deepEqual(ambiguous.calls, ["createReviewCase"]);

  const visit = setup(false);
  const visitResponse = await request(visit.app).post("/patients/PATIENT-000001/visits")
    .set("Authorization", auth(admin))
    .send({ recordReference: "off-chain-record" });
  assert.equal(visitResponse.status, 201);
  assert.deepEqual(visit.calls, ["createVisit"]);
});

test("disabled mode rejects the review decision that starts registration", async () => {
  const { app, calls } = setup(false);
  const blocked = await request(app).post("/review-cases/11111111-1111-4111-8111-111111111111/decision")
    .set("Authorization", auth(reviewer))
    .send({ decision: "different_person" });
  const allowed = await request(app).post("/review-cases/11111111-1111-4111-8111-111111111111/decision")
    .set("Authorization", auth(reviewer))
    .send({ decision: "same_patient", candidatePatientId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(blocked.status, 503);
  assert.deepEqual(blocked.body, { error: "Blockchain registration is unavailable" });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.patientId, "PATIENT-000001");
  assert.deepEqual(calls, ["resolveReviewCase"]);
});

test("enabled mode still submits a registration for the supplied patient controller", async () => {
  const { app, calls } = setup(true);
  const response = await request(app).post("/patients").set("Authorization", auth(admin)).send({
    ...profile,
    controller: "0x0000000000000000000000000000000000000001"
  });
  assert.equal(response.status, 202);
  assert.equal(response.body.status, "registration_submitted");
  assert.deepEqual(calls, ["identityCommitment", "verifySigner", "getPendingRegistrationByCommitment", "createPendingPatient", "beginRegistration", "commitmentExists", "submitRegistration", "markRegistrationSubmitted"]);
});

test("enabled registration does not invent a shared controller", async () => {
  const { app, calls } = setup(true);
  const response = await request(app).post("/patients").set("Authorization", auth(admin)).send(profile);
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "A patient controller or an ownership claim commitment is required.");
  assert.deepEqual(calls, []);
});
