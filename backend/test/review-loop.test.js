const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");
const { classifyReview } = require("../src/db");

const secret = "test-secret-that-is-long-enough";
const admin = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
const profile = { fullName: "Ayush", dateOfBirth: "2001-02-03", mobile: "9000000000" };
const caseId = "11111111-1111-4111-8111-111111111111";
const otherCaseId = "22222222-2222-4222-8222-222222222222";
const claim = `0x${"ab".repeat(32)}`;
const candidate = "33333333-3333-4333-8333-333333333333";
const novel = "44444444-4444-4444-8444-444444444444";

function auth() {
  return `Bearer ${issueToken(admin, secret)}`;
}

function appFor(action, match = { status: "possible_match", candidateCount: 1, candidates: [candidate] }) {
  const calls = [];
  let registrations = 0;
  const challenges = new Map();
  const db = {
    async getUserForAuth(id) { return id === admin.id ? admin : null; },
    identityHashes() { return [["fullName", "ayush"], ["dateOfBirth", "2001-02-03"]]; },
    async matchPatient() { return match; },
    async assessReviewAuthorization() { calls.push("assess"); return typeof action === "function" ? action() : { ...action }; },
    async createReviewCase() { calls.push("createReviewCase"); return { id: otherCaseId }; },
    async addReviewCandidates() { calls.push("addReviewCandidates"); },
    async createPendingPatient() { calls.push("createPendingPatient"); return { id: "new-patient" }; },
    async getReviewRegistration() { calls.push("getReviewRegistration"); return { id: "reviewed-patient" }; },
    async getPendingRegistrationByCommitment() { return null; },
    async beginRegistration() {
      const current = registrations;
      registrations += 1;
      calls.push("beginRegistration");
      await new Promise((resolve) => setTimeout(resolve, current === 0 ? 20 : 0));
      if (current > 0) return { id: "registration-1", status: "submitting", claimed: false };
      return { id: "registration-1", status: "unknown", claimed: true };
    },
    async markRegistrationSubmitted() { calls.push("markRegistrationSubmitted"); },
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
    async verifySigner() { return { isHospitalAdmin: true }; },
    async commitmentExists() { return false; },
    async submitRegistration() { calls.push("submitRegistration"); return { txHash: "0xtx" }; },
    async hospitalSigner() { return Wallet.createRandom().address; }
  };
  return {
    calls,
    app: createApp({
      db,
      blockchain,
      config: { corsOrigin: false, jwtSecret: secret, identityCommitmentKey: "synthetic", blockchainEnabled: true, piiEncryptionKey: "22".repeat(32) }
    })
  };
}

test("review classification keeps a different-person decision specific", () => {
  const review = { id: caseId, case_status: "resolved_different", patientStatus: "pending", candidateIds: [candidate], newPatientId: "row" };
  assert.equal(classifyReview(review, { candidateIds: [candidate] }).action, "authorized");
  assert.equal(classifyReview({ ...review, candidateIds: `{${candidate.toUpperCase()}}` }, { candidateIds: [candidate] }).action, "authorized");
  assert.equal(classifyReview(review, { candidateIds: [candidate, novel] }).action, "new_candidates");
  assert.equal(classifyReview({ ...review, case_status: "resolved_same", linkedPublicId: "PATIENT-000009" }).action, "same_person");
  assert.equal(classifyReview({ ...review, case_status: "rejected" }).action, "rejected");
  assert.equal(classifyReview({ ...review, patientStatus: "confirmed", publicPatientId: "PATIENT-000004" }).action, "used");
  assert.equal(classifyReview({ ...review, case_status: "pending" }, { candidateIds: [candidate] }).action, "pending");
});

test("a new patient with no match can be registered once", async () => {
  const { app, calls } = appFor({ action: "create" }, { status: "no_match", candidateCount: 0, candidates: [] });
  const response = await request(app).post("/patients").set("Authorization", auth()).send({ ...profile, claimCommitment: claim });
  assert.equal(response.status, 202);
  assert.equal(response.body.status, "registration_submitted");
  assert.equal(calls.includes("createReviewCase"), false);
  assert.equal(calls.includes("createPendingPatient"), true);
  assert.equal(calls.filter((name) => name === "submitRegistration").length, 1);
});

test("an old weak review does not block a patient with no identifying match", async () => {
  const { app, calls } = appFor({ action: "pending", reviewCaseId: caseId }, { status: "no_match", candidateCount: 0, candidates: [] });
  const checked = await request(app).post("/patients/match").set("Authorization", auth()).send({ ...profile, reviewCaseId: caseId });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.status, "no_match");
  const registered = await request(app).post("/patients").set("Authorization", auth()).send({ ...profile, reviewCaseId: caseId, claimCommitment: claim });
  assert.equal(registered.status, 202);
  assert.equal(registered.body.status, "registration_submitted");
  assert.equal(calls.includes("createReviewCase"), false);
  assert.equal(calls.includes("getReviewRegistration"), false);
  assert.equal(calls.includes("createPendingPatient"), true);
});

test("a possible match opens one review case", async () => {
  const { app, calls } = appFor({ action: "create" });
  const response = await request(app).post("/patients/match").set("Authorization", auth()).send(profile);
  assert.equal(response.status, 202);
  assert.equal(response.body.status, "review_required");
  assert.equal(response.body.reviewCaseId, otherCaseId);
  assert.equal(calls.filter((name) => name === "createReviewCase").length, 1);
});

test("a different-person decision lets the same patient register without another review", async () => {
  const { app, calls } = appFor({ action: "authorized", reviewCaseId: caseId });
  const checked = await request(app).post("/patients/match").set("Authorization", auth()).send({ ...profile, reviewCaseId: caseId });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.status, "review_authorized");
  assert.equal(checked.body.registrationReady, true);
  const registered = await request(app).post("/patients").set("Authorization", auth()).send({ ...profile, reviewCaseId: caseId, claimCommitment: claim });
  assert.equal(registered.status, 202);
  assert.equal(calls.includes("createReviewCase"), false);
  assert.equal(calls.includes("createPendingPatient"), false);
  assert.equal(calls.includes("getReviewRegistration"), true);
  assert.equal(calls.filter((name) => name === "submitRegistration").length, 1);
});

test("the same authorized review also accepts the patient's own wallet link", async () => {
  const wallet = Wallet.createRandom();
  const { app, calls } = appFor({ action: "authorized", reviewCaseId: caseId });
  const token = auth();
  const challenge = await request(app).post("/patient-registration/wallet-challenge").set("Authorization", token).send({ walletAddress: wallet.address });
  const signature = await wallet.signMessage(challenge.body.message);
  const registered = await request(app).post("/patients").set("Authorization", token).send({
    ...profile,
    reviewCaseId: caseId,
    controller: wallet.address,
    walletProof: { nonce: challenge.body.nonce, signature }
  });
  assert.equal(registered.status, 202);
  assert.equal(calls.includes("createReviewCase"), false);
  assert.equal(calls.includes("submitRegistration"), true);
});

test("same person, rejected, mismatched, missing, and used reviews do not create another patient", async () => {
  const token = auth();
  const same = appFor({ action: "same_person", patientId: "PATIENT-000002" });
  const sameResponse = await request(same.app).post("/patients").set("Authorization", token).send({ ...profile, reviewCaseId: caseId, claimCommitment: claim });
  assert.equal(sameResponse.status, 200);
  assert.equal(sameResponse.body.status, "existing_patient");
  assert.equal(sameResponse.body.patientId, "PATIENT-000002");

  const rejected = appFor({ action: "rejected" });
  const rejectedResponse = await request(rejected.app).post("/patients/match").set("Authorization", token).send({ ...profile, reviewCaseId: caseId });
  assert.equal(rejectedResponse.status, 409);
  assert.match(rejectedResponse.body.error, /rejected/);

  const mismatched = appFor({ action: "mismatch" });
  const mismatchedResponse = await request(mismatched.app).post("/patients").set("Authorization", token).send({ ...profile, reviewCaseId: caseId, claimCommitment: claim });
  assert.equal(mismatchedResponse.status, 409);
  assert.match(mismatchedResponse.body.error, /do not match/);

  const missing = appFor({ action: "not_found" });
  const missingResponse = await request(missing.app).post("/patients/match").set("Authorization", token).send({ ...profile, reviewCaseId: caseId });
  assert.equal(missingResponse.status, 404);

  const used = appFor({ action: "used", patientId: "PATIENT-000004" });
  const usedResponse = await request(used.app).post("/patients").set("Authorization", token).send({ ...profile, reviewCaseId: caseId, claimCommitment: claim });
  assert.equal(usedResponse.status, 409);
  assert.match(usedResponse.body.error, /already been used/);

  for (const harness of [same, rejected, mismatched, missing, used]) {
    assert.equal(harness.calls.includes("createReviewCase"), false);
    assert.equal(harness.calls.includes("createPendingPatient"), false);
    assert.equal(harness.calls.includes("submitRegistration"), false);
  }
});

test("a new candidate after approval opens one new review instead of repeating the old case", async () => {
  const { app, calls } = appFor(
    { action: "new_candidates", reviewCaseId: caseId },
    { status: "possible_match", candidateCount: 2, candidates: [candidate, novel] }
  );
  const response = await request(app).post("/patients/match").set("Authorization", auth()).send({ ...profile, reviewCaseId: caseId });
  assert.equal(response.status, 202);
  assert.equal(response.body.reviewState, "new_candidates");
  assert.equal(response.body.reviewCaseId, otherCaseId);
  assert.equal(calls.filter((name) => name === "createReviewCase").length, 1);
});

test("repeated and overlapping registration attempts do not create a second patient", async () => {
  const { app, calls } = appFor({ action: "authorized", reviewCaseId: caseId });
  const body = { ...profile, reviewCaseId: caseId, claimCommitment: claim };
  const [first, second] = await Promise.all([
    request(app).post("/patients").set("Authorization", auth()).send(body),
    request(app).post("/patients").set("Authorization", auth()).send(body)
  ]);
  const statuses = [first.body.status, second.body.status].sort();
  assert.deepEqual(statuses, ["registration_submission_in_progress", "registration_submitted"]);
  assert.equal(calls.filter((name) => name === "submitRegistration").length, 1);
  assert.equal(calls.includes("createPendingPatient"), false);
  assert.equal(calls.includes("createReviewCase"), false);
});
