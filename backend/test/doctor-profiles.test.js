const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");
const { createMemoryFileStore } = require("../src/fileStore");
const { createMemoryProfileStore, nextStatus } = require("../src/doctorProfiles");

const secret = "test-secret-that-is-long-enough";
const hospital = "hospital-a";
const doctor = { id: "11111111-1111-4111-8111-111111111111", role: "doctor", hospital_id: hospital, status: "active", token_version: 0 };
const other = { id: "22222222-2222-4222-8222-222222222222", role: "doctor", hospital_id: "hospital-b", status: "active", token_version: 0 };
const admin = { id: "33333333-3333-4333-8333-333333333333", role: "administrator", hospital_id: hospital, status: "active", token_version: 0 };
const outsider = { id: "44444444-4444-4444-8444-444444444444", role: "administrator", hospital_id: "hospital-b", status: "active", token_version: 0 };

const credentials = {
  fullName: "Dr Mehta",
  biography: "Cardiology consultations.",
  specialization: "Cardiology",
  registrationNumber: "MCI-100",
  registrationCouncil: "National Medical Commission",
  experienceYears: 12,
  department: "Cardiology",
  designation: "Consultant",
  languages: "English, Hindi",
  consultationHours: "Mon–Fri 10:00–13:00",
  qualifications: [{ degree: "MBBS", institution: "City Medical College", graduationYear: 2008 }, { degree: "MD", institution: "City Medical College", graduationYear: 2012 }]
};

function harness(fileStore = createMemoryFileStore()) {
  const users = new Map([doctor, other, admin, outsider].map((user) => [user.id, user]));
  const profiles = createMemoryProfileStore();
  profiles.seed({ id: doctor.id, hospitalId: hospital, fullName: "Dr Mehta", hospitalName: "City Hospital", bookable: true });
  profiles.seed({ id: other.id, hospitalId: "hospital-b", fullName: "Dr Rao", hospitalName: "Other Hospital", bookable: true });
  const patients = new Map([["patient-1", { id: "patient-1", hospital_id: hospital, status: "confirmed", did: "did:patient" }]]);
  const db = {
    async getUserForAuth(id) { return users.get(id) || null; },
    async getPatientForAuth(id) { return patients.get(id) || null; },
    async recordActivity() {}
  };
  const app = createApp({
    db,
    blockchain: {},
    config: { corsOrigin: false, jwtSecret: secret, identityCommitmentKey: "identity", piiEncryptionKey: "ab".repeat(32) },
    fileStore,
    profileStore: profiles
  });
  return { app, profiles };
}

test("credential edits return a verified profile to review", () => {
  const verified = { status: "verified", specialization: "Cardiology", registrationNumber: "MCI-100", experienceYears: 12, qualifications: [{ degree: "MBBS", institution: "City" }] };
  assert.equal(nextStatus(verified, { ...verified, biography: "Updated" }), "verified");
  assert.equal(nextStatus(verified, { ...verified, specialization: "Neurology" }), "pending");
  assert.equal(nextStatus({ status: "incomplete" }, { biography: "Only a biography" }), "incomplete");
});

test("a doctor submits credentials and cannot approve them", async () => {
  const { app, profiles } = harness();
  const token = issueToken(doctor, secret);
  const incomplete = await request(app).put("/doctor/profile").set("Authorization", `Bearer ${token}`).send({ biography: "Draft" });
  assert.equal(incomplete.status, 200);
  assert.equal(incomplete.body.verificationStatus, "incomplete");
  const submitted = await request(app).put("/doctor/profile").set("Authorization", `Bearer ${token}`).send(credentials);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.verificationStatus, "pending");
  assert.equal(submitted.body.hospitalName, "City Hospital");
  const selfReview = await request(app).post(`/admin/doctors/${doctor.id}/profile/review`).set("Authorization", `Bearer ${token}`).send({ decision: "verified" });
  assert.equal(selfReview.status, 403);
  const approved = await request(app).post(`/admin/doctors/${doctor.id}/profile/review`).set("Authorization", `Bearer ${issueToken(admin, secret)}`).send({ decision: "verified" });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.verificationStatus, "verified");
  const edited = await request(app).put("/doctor/profile").set("Authorization", `Bearer ${token}`).send({ ...credentials, languages: "English" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.verificationStatus, "verified");
  const changed = await request(app).put("/doctor/profile").set("Authorization", `Bearer ${token}`).send({ ...credentials, specialization: "Neurology" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.verificationStatus, "pending");
  const hidden = await request(app).get(`/admin/doctors/${doctor.id}/profile`).set("Authorization", `Bearer ${issueToken(outsider, secret)}`);
  assert.equal(hidden.status, 404);
  const foreign = await request(app).put("/doctor/profile").set("Authorization", `Bearer ${issueToken(other, secret)}`).send(credentials);
  assert.equal(foreign.body.hospitalName, "Other Hospital");
  assert.equal(profiles.doctors.get(doctor.id).specialization, "Neurology");
});

test("patients see bookable doctors without private profile notes", async () => {
  const { app } = harness();
  const { issuePatientToken } = require("../src/auth");
  const patientToken = issuePatientToken({ id: "patient-1", hospital_id: hospital, did: "did:patient" }, "0x1000000000000000000000000000000000000001", secret);
  await request(app).put("/doctor/profile").set("Authorization", `Bearer ${issueToken(doctor, secret)}`).send(credentials);
  const profile = await request(app).get(`/patient-portal/doctors/${doctor.id}`).set("Authorization", `Bearer ${patientToken}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.verificationStatus, "pending");
  assert.equal(profile.body.specialization, "Cardiology");
  assert.equal(Object.hasOwn(profile.body, "reviewNote"), false);
  assert.equal(Object.hasOwn(profile.body, "registrationNumber"), false);
  assert.equal(profile.body.degrees, "MBBS, MD");
  const otherHospital = await request(app).get(`/patient-portal/doctors/${other.id}`).set("Authorization", `Bearer ${patientToken}`);
  assert.equal(otherHospital.status, 404);
});

test("profile photos stay separate from medical files and reject other types", async () => {
  const files = createMemoryFileStore();
  const { app } = harness(files);
  const token = issueToken(doctor, secret);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const uploaded = await request(app).post("/doctor/profile/photo").set("Authorization", `Bearer ${token}`).set("Content-Type", "application/octet-stream").send(png);
  assert.equal(uploaded.status, 200);
  assert.equal([...files.objects.keys()][0].startsWith("profile/v1/"), true);
  const text = await request(app).post("/doctor/profile/photo").set("Authorization", `Bearer ${token}`).set("Content-Type", "application/octet-stream").send(Buffer.from("not-an-image!!"));
  assert.equal(text.status, 400);
  const missing = await request(app).post("/doctor/profile/photo").set("Authorization", `Bearer ${token}`).set("Content-Type", "application/octet-stream").send(png);
  assert.equal(missing.status, 200);
  const bare = createApp({
    db: { async getUserForAuth(id) { return id === doctor.id ? doctor : null; }, async recordActivity() {} },
    blockchain: {},
    config: { corsOrigin: false, jwtSecret: secret, identityCommitmentKey: "identity" },
    profileStore: (() => {
      const store = createMemoryProfileStore();
      store.seed({ id: doctor.id, hospitalId: hospital, fullName: "Dr Mehta", hospitalName: "City Hospital" });
      return store;
    })()
  });
  const unavailable = await request(bare).post("/doctor/profile/photo").set("Authorization", `Bearer ${token}`).set("Content-Type", "application/octet-stream").send(png);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error, "Profile photo storage is not configured.");
});
