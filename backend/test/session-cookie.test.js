const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const { createApp } = require("../src/app");
const { issuePatientToken, issueToken } = require("../src/auth");

const secret = "test-secret-that-is-long-enough";
const hospitalId = "hospital-a";
const doctorId = "11111111-1111-4111-8111-111111111111";
const patientRowId = "33333333-3333-4333-8333-333333333333";
const patientRef = `0x${"ab".repeat(32)}`;
const wallet = "0x6119546CBab8813aCf1c9B1ACa502f9485805A46";

function cookieHeader(response) {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value.join("\n") : String(value || "");
}

function appFor(users, patients, audits, secureCookie = false) {
  const db = {
    async authenticateUser(email, password) {
      if (email !== "doctor@hospital.org" || password !== "correct-password") return null;
      return { id: doctorId, role: "doctor", hospital_id: hospitalId, status: "active", token_version: 0, full_name: "Dr Sharma" };
    },
    async getUserForAuth(id) {
      return users[id] || null;
    },
    async getPatientForAuth(id) {
      return patients[id] || null;
    },
    async recordActivity(event) {
      audits.push(event.action);
      return { id: audits.length };
    }
  };
  return createApp({
    db,
    blockchain: {},
    config: { corsOrigin: "https://medchain-silk.vercel.app", jwtSecret: secret, secureCookie }
  });
}

test("a valid session survives refresh without a new login event", async () => {
  const audits = [];
  const users = {
    [doctorId]: { id: doctorId, role: "doctor", hospital_id: hospitalId, status: "active", token_version: 0 }
  };
  const app = appFor(users, {}, audits);
  const login = await request(app).post("/auth/token").send({ email: "doctor@hospital.org", password: "correct-password" });
  assert.equal(login.status, 200);
  const issued = cookieHeader(login);
  assert.equal(issued.includes("medchain_session="), true);
  assert.equal(issued.includes("HttpOnly"), true);
  assert.equal(issued.includes("SameSite=Lax"), true);
  assert.equal(audits.includes("LOGIN_SUCCEEDED"), true);

  const session = await request(app).get("/auth/session").set("Cookie", issued.split(";")[0]);
  assert.equal(session.status, 200);
  assert.equal(session.body.role, "doctor");
  assert.equal(session.body.id, doctorId);
  assert.equal(session.body.token, undefined);
  assert.equal(audits.filter((action) => action === "LOGIN_SUCCEEDED").length, 1);

  const blocked = await request(app).post("/auth/session-end").set("Cookie", issued.split(";")[0]);
  assert.equal(blocked.status, 401);

  const ended = await request(app)
    .post("/auth/session-end")
    .set("Cookie", issued.split(";")[0])
    .set("X-Medchain-Request", "1");
  assert.equal(ended.status, 200);
  assert.equal(cookieHeader(ended).includes("Max-Age=0"), true);
  assert.equal(audits.includes("LOGOUT"), true);

  const after = await request(app).get("/auth/session");
  assert.equal(after.status, 401);
});

test("patient refresh uses the cookie and does not accept another role", async () => {
  const patient = {
    id: patientRowId,
    patientId: "PATIENT-000010",
    did: patientRef,
    hospital_id: hospitalId,
    status: "confirmed"
  };
  const token = issuePatientToken(patient, wallet, secret);
  const doctor = issueToken({ id: doctorId, role: "doctor", hospital_id: hospitalId, token_version: 0 }, secret);
  const app = appFor(
    { [doctorId]: { id: doctorId, role: "doctor", hospital_id: hospitalId, status: "active", token_version: 0 } },
    { [patientRowId]: patient },
    []
  );
  const session = await request(app).get("/auth/session").set("Cookie", `medchain_session=${token}`);
  assert.equal(session.status, 200);
  assert.equal(session.body.role, "patient");
  assert.equal(session.body.walletAddress, wallet);
  assert.equal(session.body.patientRef, patientRef);
  assert.equal(JSON.stringify(session.body).includes("token"), false);

  const doctorOnPatient = await request(app).get("/patient-portal/files").set("Cookie", `medchain_session=${doctor}`);
  assert.equal(doctorOnPatient.status, 401);
  const patientOnAdmin = await request(app).get("/admin/activity").set("Cookie", `medchain_session=${token}`);
  assert.equal(patientOnAdmin.status, 401);
  const doctorOnAdmin = await request(app).get("/admin/activity").set("Authorization", `Bearer ${doctor}`);
  assert.equal(doctorOnAdmin.status, 403);
});

test("an expired or revoked cookie is cleared and does not restore a session", async () => {
  const users = {
    [doctorId]: { id: doctorId, role: "doctor", hospital_id: hospitalId, status: "active", token_version: 2 }
  };
  const app = appFor(users, {}, []);
  const expired = jwt.sign(
    { sub: doctorId, role: "doctor", hospitalId, tv: 2, exp: Math.floor(Date.now() / 1000) - 30 },
    secret
  );
  const stale = await request(app).get("/auth/session").set("Cookie", `medchain_session=${expired}`);
  assert.equal(stale.status, 401);
  assert.equal(cookieHeader(stale).includes("Max-Age=0"), true);

  const revoked = issueToken({ id: doctorId, role: "doctor", hospital_id: hospitalId, token_version: 0 }, secret);
  const denied = await request(app).get("/auth/session").set("Cookie", `medchain_session=${revoked}`);
  assert.equal(denied.status, 401);
  assert.equal(denied.body.token, undefined);

  const secure = appFor(users, {}, [], true);
  const login = await request(secure).post("/auth/token").send({ email: "doctor@hospital.org", password: "correct-password" });
  const issued = cookieHeader(login);
  assert.equal(issued.includes("Secure"), true);
  assert.equal(issued.includes("SameSite=None"), true);
});
