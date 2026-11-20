const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { issuePatientToken, issueToken } = require("../src/auth");
const { hashPassword, verifyPassword } = require("../src/crypto");
const { CURRENT_PASSWORD, REUSED_PASSWORD, WEAK_PASSWORD } = require("../src/passwordChange");

const secret = "test-secret-that-is-long-enough";
const config = { corsOrigin: false, jwtSecret: secret };
const roles = ["administrator", "doctor", "receptionist", "hospital_staff", "reviewer"];

function appFor(state) {
  const db = {
    async getUserForAuth(id) {
      return id === state.user.id ? { ...state.user } : null;
    },
    async getPatient() {
      return { patientId: "PATIENT-000001", status: "confirmed" };
    },
    async changePassword(userId, currentPassword, newPassword) {
      state.calls.push({ userId });
      if (userId !== state.user.id) throw Object.assign(new Error("wrong account"), { statusCode: 500 });
      if (!verifyPassword(currentPassword, state.hash)) {
        throw Object.assign(new Error(CURRENT_PASSWORD), { statusCode: 400 });
      }
      if (verifyPassword(newPassword, state.hash)) {
        throw Object.assign(new Error(REUSED_PASSWORD), { statusCode: 400 });
      }
      state.hash = hashPassword(newPassword);
      state.user = { ...state.user, token_version: state.user.token_version + 1 };
      return { id: userId };
    }
  };
  return createApp({ db, blockchain: {}, config });
}

test("password change accepts every staff role and rejects everyone else", async () => {
  for (const role of roles) {
    const state = {
      user: { id: "user-1", role, hospital_id: "h1", status: "active", token_version: 0 },
      hash: hashPassword("Current-password-1"),
      calls: []
    };
    const response = await request(appFor(state))
      .post("/auth/password")
      .set("Authorization", `Bearer ${issueToken(state.user, secret)}`)
      .send({ currentPassword: "Current-password-1", newPassword: "Replacement-password-2", userId: "someone-else" });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "password_updated" });
    assert.equal(JSON.stringify(response.body).includes("Replacement-password-2"), false);
    assert.deepEqual(state.calls, [{ userId: "user-1" }]);
    assert.equal(verifyPassword("Replacement-password-2", state.hash), true);
    assert.equal(state.user.token_version, 1);
  }

  const state = { user: { id: "user-1", role: "doctor", hospital_id: "h1", status: "active", token_version: 0 }, hash: hashPassword("Current-password-1"), calls: [] };
  const app = appFor(state);
  const missing = await request(app).post("/auth/password").send({ currentPassword: "Current-password-1", newPassword: "Replacement-password-2" });
  assert.equal(missing.status, 401);
  const patient = issuePatientToken(
    { id: "patient-1", hospital_id: "h1", did: `0x${"11".repeat(32)}` },
    `0x${"22".repeat(20)}`,
    secret
  );
  const patientResponse = await request(app).post("/auth/password").set("Authorization", `Bearer ${patient}`).send({ currentPassword: "Current-password-1", newPassword: "Replacement-password-2" });
  assert.equal(patientResponse.status, 401);
  assert.equal(state.calls.length, 0);
});

test("password change rejects a wrong, reused, or weak password without storing it", async () => {
  const state = { user: { id: "user-1", role: "doctor", hospital_id: "h1", status: "active", token_version: 2 }, hash: hashPassword("Current-password-1"), calls: [] };
  const app = appFor(state);
  const token = issueToken(state.user, secret);
  const wrong = await request(app).post("/auth/password").set("Authorization", `Bearer ${token}`).send({ currentPassword: "Wrong-password-1", newPassword: "Replacement-password-2" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, CURRENT_PASSWORD);
  const reused = await request(app).post("/auth/password").set("Authorization", `Bearer ${token}`).send({ currentPassword: "Current-password-1", newPassword: "Current-password-1" });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error, REUSED_PASSWORD);
  assert.equal(state.calls.length, 1);
  const weak = await request(app).post("/auth/password").set("Authorization", `Bearer ${token}`).send({ currentPassword: "Current-password-1", newPassword: "short" });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error, WEAK_PASSWORD);
  assert.equal(state.user.token_version, 2);
  assert.equal(verifyPassword("Current-password-1", state.hash), true);
});

test("a password change invalidates the previously issued staff session", async () => {
  const state = { user: { id: "user-1", role: "reviewer", hospital_id: "h1", status: "active", token_version: 0 }, hash: hashPassword("Current-password-1"), calls: [] };
  const app = appFor(state);
  const oldToken = issueToken(state.user, secret);
  const changed = await request(app).post("/auth/password").set("Authorization", `Bearer ${oldToken}`).send({ currentPassword: "Current-password-1", newPassword: "Replacement-password-2" });
  assert.equal(changed.status, 200);
  const stale = await request(app).get("/patients/PATIENT-000001").set("Authorization", `Bearer ${oldToken}`);
  assert.equal(stale.status, 401);
  const fresh = await request(app).get("/patients/PATIENT-000001").set("Authorization", `Bearer ${issueToken(state.user, secret)}`);
  assert.equal(fresh.status, 200);
});

test("password changes are rate limited without repeating the submitted password", async () => {
  const state = { user: { id: "user-1", role: "administrator", hospital_id: "h1", status: "active", token_version: 0 }, hash: hashPassword("Current-password-1"), calls: [] };
  const app = appFor(state);
  const token = issueToken(state.user, secret);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request(app).post("/auth/password").set("Authorization", `Bearer ${token}`).send({ currentPassword: "Current-password-1", newPassword: "weak-password" });
    assert.equal(response.status, 400);
    assert.equal(JSON.stringify(response.body).includes("weak-password"), false);
  }
  const limited = await request(app).post("/auth/password").set("Authorization", `Bearer ${token}`).send({ currentPassword: "Current-password-1", newPassword: "Replacement-password-2" });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "Too many password changes. Wait and try again.");
  assert.equal(state.calls.length, 0);
});
