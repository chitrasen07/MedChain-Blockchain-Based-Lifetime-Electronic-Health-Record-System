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
