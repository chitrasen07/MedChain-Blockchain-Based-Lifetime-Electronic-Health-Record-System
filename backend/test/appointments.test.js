const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { issueToken, issuePatientToken } = require("../src/auth");
const { encryptJson } = require("../src/crypto");
const {
  registerAppointments,
  createMemoryAppointmentStore,
  wallClockToUtc,
  wallClockInputs,
  bookingConflict
} = require("../src/appointments");

const secret = "test-secret-that-is-long-enough";
const piiKey = "11".repeat(32);
const key = Buffer.from(piiKey, "hex");
const hospitalId = "hospital-a";
const doctorId = "11111111-1111-4111-8111-111111111111";
const otherDoctorId = "22222222-2222-4222-8222-222222222222";
const patientRowId = "33333333-3333-4333-8333-333333333333";
const otherPatientRowId = "44444444-4444-4444-8444-444444444444";
const wallet = "0x6119546CBab8813aCf1c9B1ACa502f9485805A46";
const otherWallet = "0x2222222222222222222222222222222222222222";

function patientRecord(id, publicId) {
  return {
    id,
    patientId: publicId,
    did: `0x${"ab".repeat(32)}`,
    status: "confirmed",
    hospital_id: hospitalId,
    piiCiphertext: encryptJson({ fullName: publicId === "PATIENT-000010" ? "Asha Verma" : "Other Patient", mobile: "9999900000" }, key)
  };
}

function userRecord(id) {
  return { id, role: "doctor", hospital_id: hospitalId, status: "active", token_version: 0 };
}

function harness() {
  const store = createMemoryAppointmentStore();
  store.seedDoctor({ id: doctorId, hospitalId, fullName: "Dr Mehta", hospitalName: "City Hospital", verified: true, specialization: null });
  store.seedDoctor({ id: otherDoctorId, hospitalId, fullName: "Dr Rao", hospitalName: "City Hospital", verified: true, specialization: "Cardiology" });
  const patients = {
    [patientRowId]: patientRecord(patientRowId, "PATIENT-000010"),
    [otherPatientRowId]: patientRecord(otherPatientRowId, "PATIENT-000011")
  };
  const users = { [doctorId]: userRecord(doctorId), [otherDoctorId]: userRecord(otherDoctorId) };
  const db = {
    async getPatientForAuth(id) { return patients[id] || null; },
    async getUserForAuth(id) { return users[id] || null; }
  };
  const app = express();
  app.use(express.json());
  registerAppointments(app, { db, config: { jwtSecret: secret, piiEncryptionKey: piiKey }, store });
  app.use((error, _req, res, _next) => {
    const status = [400, 401, 403, 404, 409].includes(error.statusCode) ? error.statusCode : 500;
    res.status(status).json({ error: status === 500 ? "Internal server error" : error.message });
  });
  const patientToken = issuePatientToken(patients[patientRowId], wallet, secret);
  const otherToken = issuePatientToken(patients[otherPatientRowId], otherWallet, secret);
  const doctorToken = issueToken(users[doctorId], secret);
  const otherDoctorToken = issueToken(users[otherDoctorId], secret);
  return { app, store, patientToken, otherToken, doctorToken, otherDoctorToken };
}

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

test("converts a hospital wall-clock time to UTC and back", () => {
  const utc = wallClockToUtc("2027-01-15", "10:30");
  assert.equal(utc.toISOString(), "2027-01-15T05:00:00.000Z");
  assert.deepEqual(wallClockInputs(utc), { date: "2027-01-15", time: "10:30" });
});

test("treats back-to-back visits as free and overlapping visits as booked", () => {
  const rows = [{
    id: "a",
    status: "confirmed",
    confirmedStart: "2027-01-15T05:00:00.000Z",
    confirmedEnd: "2027-01-15T05:30:00.000Z"
  }];
  assert.equal(bookingConflict(rows, "2027-01-15T05:30:00.000Z", "2027-01-15T06:00:00.000Z", "b"), false);
  assert.equal(bookingConflict(rows, "2027-01-15T05:15:00.000Z", "2027-01-15T05:45:00.000Z", "b"), true);
  assert.equal(bookingConflict(rows, "2027-01-15T05:15:00.000Z", "2027-01-15T05:45:00.000Z", "a"), false);
});

test("patient request, doctor approval, reschedule, reject, and privacy", async () => {
  const { app, store, patientToken, otherToken, doctorToken, otherDoctorToken } = harness();

  const doctors = await request(app).get("/patient-portal/appointments/doctors?q=rao").set(auth(patientToken));
  assert.equal(doctors.status, 200);
  assert.equal(doctors.body.doctors.length, 1);
  assert.equal(doctors.body.doctors[0].fullName, "Dr Rao");
  assert.equal(doctors.body.doctors[0].specialization, "Cardiology");
  assert.equal(doctors.body.timezone, "Asia/Kolkata");

  const created = await request(app).post("/patient-portal/appointments").set(auth(patientToken)).send({
    doctorId,
    date: "2027-01-15",
    time: "10:00",
    reason: "Follow-up visit"
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.appointment.status, "pending");
  assert.equal(created.body.appointment.reason, "Follow-up visit");
  assert.equal(created.body.appointment.patientName, undefined);
  assert.equal(JSON.stringify(created.body).includes("9999900000"), false);
  assert.equal(JSON.stringify(created.body).includes("Ciphertext"), false);
  const id = created.body.appointment.id;

  const duplicate = await request(app).post("/patient-portal/appointments").set(auth(patientToken)).send({
    doctorId, date: "2027-01-15", time: "10:00", reason: "Follow-up visit"
  });
  assert.equal(duplicate.status, 409);

  const past = await request(app).post("/patient-portal/appointments").set(auth(patientToken)).send({
    doctorId, date: "2020-01-15", time: "10:00"
  });
  assert.equal(past.status, 400);

  const doctorList = await request(app).get("/doctor/appointments").set(auth(doctorToken));
  assert.equal(doctorList.status, 200);
  assert.equal(doctorList.body.pending.length, 1);
  assert.equal(doctorList.body.pending[0].patientName, "Asha Verma");
  assert.equal(doctorList.body.pending[0].patientId, "PATIENT-000010");
  assert.equal(doctorList.body.pending[0].reason, "Follow-up visit");

  const hidden = await request(app).get(`/doctor/appointments/${id}`).set(auth(otherDoctorToken));
  assert.equal(hidden.status, 404);
  const otherPatient = await request(app).get(`/patient-portal/appointments/${id}`).set(auth(otherToken));
  assert.equal(otherPatient.status, 404);
  const patientApprove = await request(app).post(`/doctor/appointments/${id}/approve`).set(auth(patientToken)).send({
    date: "2027-01-15", time: "10:00", durationMinutes: 30
  });
  assert.equal(patientApprove.status, 401);

  const approved = await request(app).post(`/doctor/appointments/${id}/approve`).set(auth(doctorToken)).send({
    date: "2027-01-15",
    time: "10:00",
    durationMinutes: 30,
    department: "Medicine",
    room: "12",
    notes: "Bring previous reports"
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.appointment.status, "confirmed");
  assert.equal(approved.body.appointment.confirmedStart, "2027-01-15T04:30:00.000Z");
  assert.equal(approved.body.appointment.confirmedDate, "15 Jan 2027");
  assert.equal(approved.body.appointment.confirmedTime, "10:00");
  assert.equal(approved.body.appointment.room, "12");
  assert.equal(approved.body.appointment.doctorNotes, "Bring previous reports");

  const patientView = await request(app).get("/patient-portal/appointments").set(auth(patientToken));
  assert.equal(patientView.body.upcoming.hospitalName, "City Hospital");
  assert.equal(patientView.body.upcoming.doctorName, "Dr Mehta");
  assert.equal(patientView.body.upcoming.confirmedTime, "10:00");
  assert.equal(patientView.body.upcoming.room, "12");

  const moved = await request(app).post(`/doctor/appointments/${id}/reschedule`).set(auth(doctorToken)).send({
    date: "2027-01-16", time: "11:15", durationMinutes: 15, room: "4"
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.appointment.status, "rescheduled");
  assert.equal(moved.body.appointment.confirmedTime, "11:15");
  assert.equal(moved.body.appointment.confirmedStart, "2027-01-16T05:45:00.000Z");

  const completed = await request(app).post(`/doctor/appointments/${id}/complete`).set(auth(doctorToken));
  assert.equal(completed.status, 200);
  assert.equal(completed.body.appointment.status, "completed");
  assert.equal(completed.body.appointment.visitReference, `appointment:${id}`);
  assert.equal(Object.hasOwn(completed.body.appointment, "diagnosis"), false);
  assert.equal(store.visits.length, 1);

  const second = await request(app).post("/patient-portal/appointments").set(auth(patientToken)).send({
    doctorId, date: "2027-02-02", time: "09:00"
  });
  const rejected = await request(app).post(`/doctor/appointments/${second.body.appointment.id}/reject`).set(auth(doctorToken)).send({
    reason: "Doctor is on leave"
  });
  assert.equal(rejected.status, 200);
  const afterReject = await request(app).get(`/patient-portal/appointments/${second.body.appointment.id}`).set(auth(patientToken));
  assert.equal(afterReject.body.appointment.status, "rejected");
  assert.equal(afterReject.body.appointment.rejectionReason, "Doctor is on leave");
  const approveRejected = await request(app).post(`/doctor/appointments/${second.body.appointment.id}/approve`).set(auth(doctorToken)).send({
    date: "2027-02-02", time: "09:00", durationMinutes: 30
  });
  assert.equal(approveRejected.status, 409);
});

test("prevents overlapping confirmed appointments and unauthorized reads", async () => {
  const { app, patientToken, otherToken, doctorToken } = harness();
  const first = await request(app).post("/patient-portal/appointments").set(auth(patientToken)).send({
    doctorId, date: "2027-03-01", time: "10:00"
  });
  const second = await request(app).post("/patient-portal/appointments").set(auth(otherToken)).send({
    doctorId, date: "2027-03-01", time: "10:15"
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const approved = await request(app).post(`/doctor/appointments/${first.body.appointment.id}/approve`).set(auth(doctorToken)).send({
    date: "2027-03-01", time: "10:00", durationMinutes: 30, room: "2"
  });
  assert.equal(approved.status, 200);
  const clash = await request(app).post(`/doctor/appointments/${second.body.appointment.id}/approve`).set(auth(doctorToken)).send({
    date: "2027-03-01", time: "10:15", durationMinutes: 30
  });
  assert.equal(clash.status, 409);
  const adjacent = await request(app).post(`/doctor/appointments/${second.body.appointment.id}/approve`).set(auth(doctorToken)).send({
    date: "2027-03-01", time: "10:30", durationMinutes: 30
  });
  assert.equal(adjacent.status, 200);
  const outsider = await request(app).get("/patient-portal/appointments").set(auth(otherToken));
  assert.equal(outsider.body.appointments.length, 1);
  assert.equal(outsider.body.appointments[0].id, second.body.appointment.id);
});
