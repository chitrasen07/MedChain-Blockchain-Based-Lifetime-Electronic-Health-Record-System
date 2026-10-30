const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");

const config = { corsOrigin: false, jwtSecret: "test-secret-that-is-long-enough", identityCommitmentKey: "test", controllerAddress: "0x1" };
const profile = { fullName: "Synthetic Patient", dateOfBirth: "1990-01-01", email: "synthetic@example.test" };
const reviewer = { id: "reviewer", role: "reviewer", hospital_id: "hospital-a", status: "active" };
const doctor = { id: "doctor", role: "doctor", hospital_id: "hospital-a", status: "active" };

function setup(user, matchResult = { status: "no_match", candidateCount: 0, candidates: [] }, caseHospital = "hospital-a") {
  const calls = [];
  const db = {
    async getUserForAuth(id) { return id === user.id ? user : null; },
    identityHashes() { return [["fullName", "hash"]]; },
    async matchPatient() { return matchResult; },
    async createReviewCase(...args) { calls.push(["createReviewCase", args]); return { id: "11111111-1111-4111-8111-111111111111" }; },
    async listReviewCases(hospitalId) { calls.push(["list", hospitalId]); return [{ id: "case-1", status: "pending" }]; },
    async getReviewCase(id, hospitalId) {
      calls.push(["get", id, hospitalId]);
      return hospitalId === caseHospital ? { id, status: "pending", candidateIds: ["candidate-1"] } : null;
    },
    async resolveReviewCase(...args) {
      calls.push(["resolve", args]);
      return args[1].decision === "different_person"
        ? { status: "resolved_different", linkedPatientId: null }
        : { status: "resolved_same", linkedPatientId: "PATIENT-000001" };
    }
  };
  const blockchain = { identityCommitment() { calls.push(["commitment"]); return "0x" + "11".repeat(32); } };
  return { app: createApp({ db, blockchain, config }), calls };
}

function auth(user) {
  return `Bearer ${issueToken(user, config.jwtSecret)}`;
}

test("no credible match does not create a review case", async () => {
  const { app, calls } = setup(reviewer);
  const response = await request(app).post("/patients/match").set("Authorization", auth(reviewer)).send(profile);
  assert.equal(response.status, 200);
  assert.equal(response.body.status, "no_match");
  assert.equal(calls.length, 0);
});

test("ambiguous match creates a review case without blockchain submission", async () => {
  const { app, calls } = setup(reviewer, { status: "possible_match", candidateCount: 2, candidates: ["one", "two"] });
  const response = await request(app).post("/patients/match").set("Authorization", auth(reviewer)).send(profile);
  assert.equal(response.status, 202);
  assert.equal(response.body.status, "review_required");
  assert.equal(calls[0][0], "createReviewCase");
  assert.equal(calls.some(([name]) => name === "commitment"), false);
});

test("doctors cannot resolve review cases", async () => {
  const { app } = setup(doctor);
  const response = await request(app).post("/review-cases/case-1/decision")
    .set("Authorization", auth(doctor))
    .send({ decision: "same_patient", candidatePatientId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(response.status, 403);
});

test("reviewers can list, inspect, and resolve hospital-scoped cases", async () => {
  const { app, calls } = setup(reviewer);
  const list = await request(app).get("/review-cases").set("Authorization", auth(reviewer));
  const detail = await request(app).get("/review-cases/case-1").set("Authorization", auth(reviewer));
  const resolved = await request(app).post("/review-cases/case-1/decision")
    .set("Authorization", auth(reviewer))
    .send({ decision: "same_patient", candidatePatientId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(list.status, 200);
  assert.equal(detail.status, 200);
  assert.equal(resolved.body.patientId, "PATIENT-000001");
  assert.deepEqual(calls[0], ["list", "hospital-a"]);
  assert.deepEqual(calls[1], ["get", "case-1", "hospital-a"]);
});

test("review responses do not include sensitive profile fields", async () => {
  const { app } = setup(reviewer);
  const response = await request(app).get("/review-cases/case-1").set("Authorization", auth(reviewer));
  assert.equal(response.body.fullName, undefined);
  assert.equal(response.body.dateOfBirth, undefined);
  assert.equal(JSON.stringify(response.body).includes("synthetic@example.test"), false);
});

test("government identity fields are absent from registration schema", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "app.js"), "utf8").toLowerCase();
  for (const field of ["aadhaar", "passport", "drivinglicence", "pan"]) assert.equal(source.includes(field), false);
});

test("high-confidence match returns the existing patient without a commitment", async () => {
  const admin = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
  const { app, calls } = setup(admin, {
    status: "high_confidence",
    patient: { patient_id: "PATIENT-000001", did: "did:medchain:test" },
    candidates: ["one"]
  });
  const response = await request(app).post("/patients").set("Authorization", auth(admin)).send(profile);
  assert.equal(response.status, 200);
  assert.equal(response.body.patientId, "PATIENT-000001");
  assert.equal(calls.some(([name]) => name === "commitment"), false);
});

test("ambiguous registration is blocked before any blockchain transaction", async () => {
  const admin = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
  const { app, calls } = setup(admin, { status: "possible_match", candidateCount: 2, candidates: ["one", "two"] });
  const response = await request(app).post("/patients").set("Authorization", auth(admin)).send(profile);
  assert.equal(response.status, 202);
  assert.equal(response.body.status, "review_required");
  assert.equal(calls.some(([name]) => name === "commitment"), false);
});

test("repeated review resolution is represented as an already-resolved result", async () => {
  const { app, calls } = setup(reviewer);
  const first = await request(app).post("/review-cases/case-1/decision")
    .set("Authorization", auth(reviewer))
    .send({ decision: "same_patient", candidatePatientId: "11111111-1111-4111-8111-111111111111" });
  const second = await request(app).post("/review-cases/case-1/decision")
    .set("Authorization", auth(reviewer))
    .send({ decision: "same_patient", candidatePatientId: "11111111-1111-4111-8111-111111111111" });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls.filter(([name]) => name === "resolve").length, 2);
});

test("cross-hospital review access returns not found", async () => {
  const otherHospitalReviewer = { ...reviewer, hospital_id: "hospital-b" };
  const { app } = setup(otherHospitalReviewer);
  const response = await request(app).get("/review-cases/case-1").set("Authorization", auth(otherHospitalReviewer));
  assert.equal(response.status, 404);
});

test("different-person resolution explicitly permits a later registration", async () => {
  const { app } = setup(reviewer);
  const response = await request(app).post("/review-cases/case-1/decision")
    .set("Authorization", auth(reviewer))
    .send({ decision: "different_person" });
  assert.equal(response.status, 200);
  assert.equal(response.body.registrationRequired, true);
});

test("concurrent ambiguous requests use the same review creation path", async () => {
  const { app, calls } = setup(reviewer, { status: "possible_match", candidateCount: 2, candidates: ["one", "two"] });
  const responses = await Promise.all([
    request(app).post("/patients/match").set("Authorization", auth(reviewer)).send(profile),
    request(app).post("/patients/match").set("Authorization", auth(reviewer)).send(profile)
  ]);
  assert.equal(responses[0].status, 202);
  assert.equal(responses[1].status, 202);
  assert.equal(calls.filter(([name]) => name === "createReviewCase").length, 2);
});
