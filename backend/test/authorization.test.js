const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");

const config = {
  corsOrigin: false,
  jwtSecret: "test-secret-that-is-long-enough"
};

function setup(user) {
  const calls = [];
  const db = {
    async getUserForAuth(id) {
      return id === user.id ? user : null;
    },
    async getPatient(patientId, hospitalId) {
      calls.push({ patientId, hospitalId });
      return { patientId, did: "did:medchain:test", status: "confirmed" };
    },
    async createUser(input) {
      calls.push({ provisioned: input });
      return { id: "u2", email: input.email, role: input.role, status: "active" };
    }
  };
  return { app: createApp({ db, blockchain: {}, config }), calls };
}

function token(user) {
  return issueToken(user, config.jwtSecret);
}

test("patient access rejects unauthenticated requests", async () => {
  const { app } = setup({ id: "u1", role: "doctor", hospital_id: "h1", status: "active" });
  const response = await request(app).get("/patients/PATIENT-000001");
  assert.equal(response.status, 401);
});

test("patient registration rejects a doctor without administrator permission", async () => {
  const user = { id: "u1", role: "doctor", hospital_id: "h1", status: "active" };
  const { app } = setup(user);
  const response = await request(app)
    .post("/patients")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({ fullName: "Synthetic Patient", dateOfBirth: "1990-01-01" });
  assert.equal(response.status, 403);
});

test("disabled users cannot use a previously issued token", async () => {
  const user = { id: "u1", role: "doctor", hospital_id: "h1", status: "disabled" };
  const { app } = setup(user);
  const response = await request(app)
    .get("/patients/PATIENT-000001")
    .set("Authorization", `Bearer ${token(user)}`);
  assert.equal(response.status, 401);
});

test("authorized patient access is scoped to the current hospital", async () => {
  const user = { id: "u1", role: "doctor", hospital_id: "hospital-a", status: "active" };
  const { app, calls } = setup(user);
  const response = await request(app)
    .get("/patients/PATIENT-000001")
    .set("Authorization", `Bearer ${token(user)}`);
  assert.equal(response.status, 200);
  assert.equal(calls[0].hospitalId, "hospital-a");
});

test("reviewers can resolve cases but cannot provision users", async () => {
  const user = { id: "u1", role: "reviewer", hospital_id: "hospital-a", status: "active" };
  const { app } = setup(user);
  const response = await request(app)
    .post("/admin/users")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({ email: "staff@example.test", password: "synthetic-password", role: "doctor" });
  assert.equal(response.status, 403);
});

test("hospital administrators can provision least-privilege users in their hospital", async () => {
  const user = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
  const { app } = setup(user);
  const response = await request(app)
    .post("/admin/users")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({ email: "doctor@example.test", password: "synthetic-password", role: "doctor" });
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    id: "u2",
    email: "doctor@example.test",
    role: "doctor",
    status: "active"
  });
});

test("authenticated writes record the database user id as the actor", async () => {
  const doctor = { id: "doctor-id", role: "doctor", hospital_id: "hospital-a", status: "active" };
  const receptionist = { id: "receptionist-id", role: "receptionist", hospital_id: "hospital-a", status: "active" };
  const reviewer = { id: "reviewer-id", role: "reviewer", hospital_id: "hospital-a", status: "active" };
  const admin = { id: "admin-id", role: "administrator", hospital_id: "hospital-a", status: "active" };
  const users = [doctor, receptionist, reviewer, admin];
  const calls = [];
  const db = {
    async getUserForAuth(id) {
      return users.find((user) => user.id === id) || null;
    },
    identityHashes() {
      return [["fullName", "hash"]];
    },
    async matchPatient() {
      return { status: "possible_match", candidateCount: 1, candidates: ["candidate-1"] };
    },
    async createReviewCase(profile, hashes, candidates, actorId, hospitalId) {
      calls.push({ action: "review", actorId, hospitalId, profile, hashes, candidates });
      return { id: "11111111-1111-4111-8111-111111111111" };
    },
    async createVisit(patientId, input, actorId, hospitalId) {
      calls.push({ action: "visit", patientId, input, actorId, hospitalId });
      return { id: "visit-1" };
    },
    async resolveReviewCase(id, input, actorId, hospitalId) {
      calls.push({ action: "resolve", id, input, actorId, hospitalId });
      return { status: "rejected", linkedPatientId: null };
    },
    async disableUser(userId, actorId, hospitalId) {
      calls.push({ action: "disable", userId, actorId, hospitalId });
    }
  };
  const app = createApp({ db, blockchain: {}, config });

  const visit = await request(app)
    .post("/patients/PATIENT-000001/visits")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ recordReference: "visit-ref-1", recordHash: `0x${"ab".repeat(32)}` });
  assert.equal(visit.status, 201);
  assert.equal(visit.body.visitId, "visit-1");
  assert.equal(calls[0].actorId, doctor.id);
  assert.equal(calls[0].hospitalId, "hospital-a");

  const match = await request(app)
    .post("/patients/match")
    .set("Authorization", `Bearer ${token(receptionist)}`)
    .send({ fullName: "Synthetic Patient", dateOfBirth: "1990-01-01" });
  assert.equal(match.status, 202);
  assert.equal(calls[1].action, "review");
  assert.equal(calls[1].actorId, receptionist.id);

  const decision = await request(app)
    .post("/review-cases/11111111-1111-4111-8111-111111111111/decision")
    .set("Authorization", `Bearer ${token(reviewer)}`)
    .send({ decision: "reject" });
  assert.equal(decision.status, 200);
  assert.equal(calls[2].actorId, reviewer.id);

  const disabled = await request(app)
    .post("/admin/users/staff-id/disable")
    .set("Authorization", `Bearer ${token(admin)}`);
  assert.equal(disabled.status, 204);
  assert.equal(calls[3].actorId, admin.id);
  assert.equal(calls.every((call) => call.actorId && call.actorId === users.find((user) => user.id === call.actorId).id), true);
  assert.equal(users.some((user) => Object.hasOwn(user, "sub")), false);
});

test("duplicate staff email returns 409 without the database detail", async () => {
  const user = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
  const db = {
    async getUserForAuth(id) {
      return id === user.id ? user : null;
    },
    async createUser() {
      const error = new Error('duplicate key value violates unique constraint "users_email_key"');
      error.code = "23505";
      error.constraint = "users_email_key";
      error.detail = "Key (email)=(doctor@example.test) already exists.";
      throw error;
    }
  };
  const app = createApp({ db, blockchain: {}, config });
  const response = await request(app)
    .post("/admin/users")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({ email: "doctor@example.test", password: "synthetic-password", role: "doctor" });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { error: "A staff account with this email already exists." });
  assert.equal(JSON.stringify(response.body).includes("doctor@example.test"), false);
  assert.equal(JSON.stringify(response.body).includes("users_email_key"), false);
});

test("a different unique violation stays an internal error", async () => {
  const user = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
  const db = {
    async getUserForAuth(id) {
      return id === user.id ? user : null;
    },
    async createUser() {
      const error = new Error('duplicate key value violates unique constraint "patients_patient_id_key"');
      error.code = "23505";
      error.constraint = "patients_patient_id_key";
      error.detail = "Key (patient_id)=(PATIENT-000001) already exists.";
      throw error;
    }
  };
  const app = createApp({ db, blockchain: {}, config });
  const response = await request(app)
    .post("/admin/users")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({ email: "doctor@example.test", password: "synthetic-password", role: "doctor" });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "Internal server error" });
  assert.equal(JSON.stringify(response.body).includes("PATIENT-000001"), false);
});

test("intentional registration conflicts stay HTTP 409", async () => {
  const user = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
  const reviewId = "11111111-1111-4111-8111-111111111111";
  const db = {
    async getUserForAuth() {
      return user;
    },
    identityHashes() {
      return [["fullName", "hash"]];
    },
    async matchPatient() {
      return { status: "no_match", candidateCount: 0, candidates: [] };
    },
    async getPendingRegistrationByCommitment() {
      return null;
    },
    async createPendingPatient() {
      return { id: "patient-row" };
    },
    async beginRegistration() {
      return { id: "reg-1", status: "submitting", claimed: true };
    },
    async markRegistrationSubmitted() {
      throw Object.assign(new Error("Registration attempt is no longer retryable"), { statusCode: 409 });
    },
    async getReviewRegistration() {
      throw Object.assign(new Error("Registration review is not ready"), { statusCode: 409 });
    }
  };
  const blockchain = {
    identityCommitment() {
      return `0x${"ab".repeat(32)}`;
    },
    async submitRegistration() {
      return { txHash: `0x${"cd".repeat(32)}` };
    }
  };
  const app = createApp({
    db,
    blockchain,
    config: {
      ...config,
      blockchainEnabled: true,
      identityCommitmentKey: "synthetic",
      controllerAddress: "0x0000000000000000000000000000000000000001"
    }
  });
  const retry = await request(app)
    .post("/patients")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({ fullName: "Synthetic Patient", dateOfBirth: "1990-01-01" });
  assert.equal(retry.status, 409);
  assert.deepEqual(retry.body, { error: "Registration attempt is no longer retryable" });

  const review = await request(app)
    .post("/patients")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({ fullName: "Synthetic Patient", dateOfBirth: "1990-01-01", reviewCaseId: reviewId });
  assert.equal(review.status, 409);
  assert.deepEqual(review.body, { error: "Registration review is not ready" });
});
