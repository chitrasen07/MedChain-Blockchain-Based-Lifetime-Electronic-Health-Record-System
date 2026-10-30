const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");

const config = {
  corsOrigin: false,
  jwtSecret: "test-secret-that-is-long-enough",
  identityCommitmentKey: "synthetic",
  controllerAddress: "0x0000000000000000000000000000000000000001"
};
const admin = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
const profile = { fullName: "Synthetic Registration", dateOfBirth: "1980-01-01" };

function setup(reconciliation, commitmentAlreadyExists = false, registrationStatus = "unknown", submissionError = false) {
  let attempts = 0;
  let submitted = 0;
  let result = { id: "registration-1", status: registrationStatus, claimed: registrationStatus === "unknown" };
  const db = {
    async getUserForAuth() { return admin; },
    identityHashes() { return [["fullName", "synthetic-hash"]]; },
    async matchPatient() { return { status: "no_match", candidates: [], candidateCount: 0 }; },
    async createPendingPatient() { return { id: "patient-row-1" }; },
    async getPendingRegistrationByCommitment() { return null; },
    async beginRegistration() { attempts += 1; return result; },
    async markRegistrationSubmitted(id, txHash) {
      submitted += 1;
      result = { id, status: "submitted", txHash };
    },
    async markRegistrationResult(id, value) {
      result = { id, status: value.status, txHash: value.txHash, chainPatientId: value.patientId, chainDid: value.did };
      return result;
    },
    async confirmPatient(_id, chain) { return { patientId: chain.patientId, did: chain.did, txHash: chain.txHash }; }
  };
  const blockchain = {
    identityCommitment() { return "0x" + "11".repeat(32); },
    async commitmentExists() { return commitmentAlreadyExists; },
    async submitRegistration() {
      if (submissionError) throw new Error("synthetic RPC failure");
      return { txHash: "0xtx1" };
    },
    async reconcileRegistration() { return reconciliation(); }
  };
  const app = createApp({ db, blockchain, config });
  return { app, counts: () => ({ attempts, submitted }) };
}

function auth() {
  return `Bearer ${issueToken(admin, config.jwtSecret)}`;
}

test("registration persists the hash first and reconciles a delayed receipt", async () => {
  let poll = 0;
  const { app, counts } = setup(() => (++poll === 1
    ? { status: "pending", txHash: "0xtx1" }
    : { status: "confirmed", txHash: "0xtx1", patientId: "PATIENT-000001", did: "did:medchain:test" }));
  const first = await request(app).post("/patients").set("Authorization", auth()).send(profile);
  const second = await request(app).post("/patients").set("Authorization", auth()).send(profile);
  const third = await request(app).post("/patients").set("Authorization", auth()).send(profile);
  assert.equal(first.body.status, "registration_submitted");
  assert.equal(second.body.status, "registration_pending");
  assert.equal(third.body.patientId, "PATIENT-000001");
  assert.deepEqual(counts(), { attempts: 3, submitted: 1 });
});

test("an uncertain attempt with an existing commitment is never resubmitted", async () => {
  const { app, counts } = setup(() => ({ status: "pending", txHash: "0xtx1" }), true);
  const response = await request(app).post("/patients").set("Authorization", auth()).send(profile);
  assert.equal(response.body.status, "registration_reconciliation_required");
  assert.equal(counts().submitted, 0);
});

test("a concurrent submission claim prevents a second blockchain submission", async () => {
  const { app, counts } = setup(() => ({ status: "pending", txHash: "0xtx1" }), false, "submitting");
  const response = await request(app).post("/patients").set("Authorization", auth()).send(profile);
  assert.equal(response.body.status, "registration_submission_in_progress");
  assert.equal(counts().submitted, 0);
});

test("an RPC submission error leaves the registration requiring reconciliation", async () => {
  const { app, counts } = setup(() => ({ status: "pending", txHash: "0xtx1" }), false, "unknown", true);
  const response = await request(app).post("/patients").set("Authorization", auth()).send(profile);
  assert.equal(response.body.status, "registration_reconciliation_required");
  assert.equal(counts().submitted, 0);
});
