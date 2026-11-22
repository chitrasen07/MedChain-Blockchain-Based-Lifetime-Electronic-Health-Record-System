const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { Wallet } = require("ethers");
const { issueToken, issuePatientToken } = require("../src/auth");
const { registerActivityAudit, createMemoryActivityStore, repeatedView, formatIst, safeMetadata } = require("../src/activityAudit");

const secret = "test-secret-that-is-long-enough";
const hospitalId = "hospital-a";
const otherHospital = "hospital-b";
const doctorId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const patientRowId = "33333333-3333-4333-8333-333333333333";
const otherPatientRowId = "44444444-4444-4444-8444-444444444444";
const patientRef = `0x${"ab".repeat(32)}`;
const wallet = "0x6119546CBab8813aCf1c9B1ACa502f9485805A46";

function user(id, role, hospital = hospitalId) {
  return { id, role, hospital_id: hospital, status: "active", token_version: 0 };
}

function patient(id, publicId) {
  return { id, patientId: publicId, did: patientRef, status: "confirmed", hospital_id: hospitalId };
}

test("formats audit time in India Standard Time and drops sensitive metadata", () => {
  assert.equal(formatIst("2026-11-22T05:00:00.000Z"), "22 Nov 2026, 10:30 AM IST");
  assert.deepEqual(safeMetadata({ status: "confirmed", reason: "chest pain", password: "secret", txHash: "0xabc" }), {
    status: "confirmed",
    txHash: "0xabc"
  });
});

test("does not record a repeated profile view inside the quiet period", () => {
  const now = Date.parse("2026-11-22T05:00:00.000Z");
  const previous = [{ action: "record_viewed", patientId: patientRowId, actorId: doctorId, actorRole: "doctor", createdAt: new Date(now - 60_000).toISOString() }];
  const again = { action: "record_viewed", patientId: patientRowId, actorId: doctorId, actorRole: "doctor" };
  assert.equal(repeatedView(previous, again, now), true);
  assert.equal(repeatedView(previous, { ...again, actorId: "99999999-9999-4999-8999-999999999999" }, now), false);
  assert.equal(repeatedView([{ ...previous[0], createdAt: new Date(now - 16 * 60_000).toISOString() }], again, now), false);
});

test("patients, doctors, and hospital admins see only authorized activity", async () => {
  const store = createMemoryActivityStore();
  const patients = {
    [patientRowId]: patient(patientRowId, "PATIENT-000010"),
    [otherPatientRowId]: patient(otherPatientRowId, "PATIENT-000011")
  };
  const users = {
    [doctorId]: user(doctorId, "doctor"),
    [adminId]: user(adminId, "administrator")
  };
  const doctorWallet = Wallet.createRandom();
  const hospitalWallet = Wallet.createRandom();
  const db = {
    async getPatientForAuth(id) { return patients[id] || null; },
    async getUserForAuth(id) { return users[id] || null; },
    async getPatient(publicId, hospital) {
      return Object.values(patients).find((item) => item.patientId === publicId && item.hospital_id === hospital) || null;
    },
    async getClinicalWallet() { return doctorWallet.address; },
    async recordActivity(event) {
      return store.record({
        ...event,
        patientRowId: event.patientRowId || event.patientId || (event.publicPatientId === "PATIENT-000010" ? patientRowId : null),
        publicPatientId: event.publicPatientId || null
      });
    }
  };
  const blockchain = {
    async hospitalSigner() { return hospitalWallet.address; },
    async isMedicalStaff() { return true; },
    async hasAccess() { return false; },
    async checkEmergencyAccess() { return false; }
  };
  const app = express();
  app.use(express.json());
  registerActivityAudit(app, { db, blockchain, config: { jwtSecret: secret }, store });
  app.use((error, _req, res, _next) => {
    const status = [400, 401, 403, 404, 409].includes(error.statusCode) ? error.statusCode : 500;
    res.status(status).json({ error: status === 500 ? "Internal server error" : error.message });
  });

  await store.record({
    actorId: doctorId,
    actorRole: "doctor",
    actorLabel: "Dr Sharma",
    hospitalId,
    patientRowId,
    publicPatientId: "PATIENT-000010",
    action: "record_viewed",
    category: "records",
    outcome: "success",
    createdAt: new Date("2026-11-22T05:00:00.000Z"),
    metadata: { reason: "chest pain", medication: "hidden", status: "confirmed" }
  });
  await store.record({
    actorId: doctorId,
    actorRole: "doctor",
    actorLabel: "Dr Sharma",
    hospitalId,
    patientRowId,
    publicPatientId: "PATIENT-000010",
    action: "APPOINTMENT_APPROVED",
    category: "appointment",
    outcome: "success",
    resourceId: "appointment-1",
    createdAt: new Date("2026-11-22T06:00:00.000Z")
  });
  await store.record({
    actorId: doctorId,
    actorRole: "doctor",
    actorLabel: "Dr Sharma",
    hospitalId,
    action: "LOGIN_SUCCEEDED",
    category: "login",
    outcome: "success",
    createdAt: new Date("2026-11-22T04:00:00.000Z")
  });
  await store.record({
    actorId: adminId,
    actorRole: "administrator",
    actorLabel: "Admin",
    hospitalId: otherHospital,
    action: "LOGIN_SUCCEEDED",
    category: "login",
    outcome: "success",
    createdAt: new Date("2026-11-22T04:30:00.000Z")
  });
  await store.record({
    actorId: doctorId,
    actorRole: "doctor",
    actorLabel: "Dr Sharma",
    hospitalId,
    patientRowId,
    publicPatientId: "PATIENT-000010",
    action: "record_created",
    category: "changes",
    outcome: "success",
    createdAt: new Date("2026-11-22T07:00:00.000Z")
  });

  const patientToken = issuePatientToken(patients[patientRowId], wallet, secret);
  const otherToken = issuePatientToken(patients[otherPatientRowId], wallet, secret);
  const doctorToken = issueToken(users[doctorId], secret);
  const adminToken = issueToken(users[adminId], secret);
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const own = await request(app).get("/patient-portal/activity").set(auth(patientToken));
  assert.equal(own.status, 200);
  assert.equal(own.body.events.some((event) => event.summary.includes("Dr Sharma viewed your medical history")), true);
  assert.equal(own.body.events.some((event) => event.summary.includes("22 Nov 2026, 10:30 AM IST")), true);
  assert.equal(JSON.stringify(own.body).includes("chest pain"), false);
  assert.equal(JSON.stringify(own.body).includes("hidden"), false);
  assert.equal(own.body.events.some((event) => event.action === "LOGIN_SUCCEEDED"), false);

  const appointments = await request(app).get("/patient-portal/activity?filter=appointments").set(auth(patientToken));
  assert.equal(appointments.body.events.length, 1);
  assert.equal(appointments.body.events[0].action, "APPOINTMENT_APPROVED");

  const other = await request(app).get("/patient-portal/activity").set(auth(otherToken));
  assert.equal(other.status, 200);
  assert.equal(other.body.events.length, 0);

  const doctor = await request(app).get("/doctor/activity?filter=logins").set(auth(doctorToken));
  assert.equal(doctor.status, 200);
  assert.equal(doctor.body.events.length, 1);
  assert.equal(doctor.body.events[0].action, "LOGIN_SUCCEEDED");
  assert.equal(doctor.body.events[0].actorId, doctorId);

  const denied = await request(app).get("/doctor/activity?patientId=PATIENT-000010").set(auth(doctorToken));
  assert.equal(denied.status, 403);
  const afterDenial = await request(app).get("/patient-portal/activity?filter=consent").set(auth(patientToken));
  assert.equal(afterDenial.body.events.some((event) => event.action === "ACCESS_DENIED" && event.outcome === "denied"), true);

  const admin = await request(app).get("/admin/activity").set(auth(adminToken));
  assert.equal(admin.status, 200);
  assert.equal(admin.body.events.every((event) => event.summary), true);
  assert.equal(JSON.stringify(admin.body).includes(otherHospital), false);

  const page = await request(app).get("/patient-portal/activity?limit=2").set(auth(patientToken));
  assert.equal(page.body.events.length, 2);
  assert.ok(page.body.nextCursor);
  const older = await request(app).get(`/patient-portal/activity?limit=2&before=${encodeURIComponent(page.body.nextCursor)}`).set(auth(patientToken));
  assert.equal(older.status, 200);
  assert.equal(older.body.events.length >= 1, true);
  assert.equal(older.body.events.some((event) => page.body.events.some((shown) => shown.id === event.id)), false);

  const firstView = await db.recordActivity({
    actorId: doctorId,
    actorRole: "doctor",
    hospitalId,
    patientId: patientRowId,
    action: "PATIENT_LOOKUP",
    category: "profile"
  });
  const secondView = await db.recordActivity({
    actorId: doctorId,
    actorRole: "doctor",
    hospitalId,
    patientId: patientRowId,
    action: "PATIENT_LOOKUP",
    category: "profile"
  });
  assert.equal(secondView.skipped, true);
  assert.equal(firstView.action, "PATIENT_LOOKUP");
});
