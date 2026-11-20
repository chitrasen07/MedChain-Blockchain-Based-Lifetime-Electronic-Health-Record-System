const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");
const { decryptJson } = require("../src/crypto");
const { recordContentHash } = require("../src/clinicalRecords");

const secret = "test-secret-that-is-long-enough";
const piiKey = "22".repeat(32);
const doctor = { id: "doctor-1", role: "doctor", hospital_id: "hospital-a", status: "active" };
const staff = { id: "staff-1", role: "hospital_staff", hospital_id: "hospital-a", status: "active" };
const receptionist = { id: "desk-1", role: "receptionist", hospital_id: "hospital-a", status: "active" };
const admin = { id: "admin-1", role: "administrator", hospital_id: "hospital-a", status: "active" };

function token(user) {
  return issueToken(user, secret);
}

function harness() {
  const calls = [];
  const rows = [];
  const users = {
    [doctor.id]: doctor,
    [staff.id]: staff,
    [receptionist.id]: receptionist,
    [admin.id]: admin
  };
  const db = {
    async getUserForAuth(id) {
      return users[id] || null;
    },
    async getPatient(patientId, hospitalId) {
      calls.push(["patient", patientId, hospitalId]);
      if (patientId !== "PATIENT-000001" || hospitalId !== "hospital-a") return null;
      return { patientId, did: "0x11", status: "confirmed" };
    },
    async getMedicalRecord(id, hospitalId) {
      return rows.find((row) => row.id === id && row.hospitalId === hospitalId) || null;
    },
    async createMedicalRecord(input) {
      calls.push("create");
      const row = {
        id: `11111111-1111-4111-8111-${String(rows.length + 1).padStart(12, "0")}`,
        hospitalId: input.hospitalId,
        publicPatientId: input.publicPatientId,
        ...input,
        chainStatus: "consent_required",
        txHash: null
      };
      rows.push(row);
      return row;
    },
    async listMedicalRecordsByPublicId(patientId, hospitalId) {
      calls.push(["list", patientId, hospitalId]);
      return rows.filter((row) => row.publicPatientId === patientId && row.hospitalId === hospitalId);
    }
  };
  const blockchain = {
    async submitRegistration() {
      calls.push("submit");
    },
    async getController() {
      calls.push("controller");
    }
  };
  const app = createApp({
    db,
    blockchain,
    config: { corsOrigin: false, jwtSecret: secret, piiEncryptionKey: piiKey }
  });
  return { app, calls, rows };
}

test("clinical staff store an encrypted record without anchoring it", async () => {
  const { app, calls, rows } = harness();
  const created = await request(app)
    .post("/patients/PATIENT-000001/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({
      category: "allergy",
      recordedOn: "2026-04-01",
      fields: { substance: "Penicillin", reaction: "Rash" }
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.chainStatus, "consent_required");
  assert.equal(created.body.transaction, null);
  assert.equal(created.body.anchoring, "disabled");
  assert.equal(created.body.content.substance, "Penicillin");
  assert.equal(created.body.contentHash, recordContentHash({
    category: "allergy",
    reaction: "Rash",
    recordedOn: "2026-04-01",
    substance: "Penicillin"
  }));
  assert.equal(rows[0].contentCiphertext.includes("Penicillin"), false);
  assert.equal(created.body.recordRef.includes("Penicillin"), false);
  assert.deepEqual(decryptJson(rows[0].contentCiphertext, Buffer.from(piiKey, "hex")), {
    category: "allergy",
    recordedOn: "2026-04-01",
    substance: "Penicillin",
    reaction: "Rash"
  });
  const appended = await request(app)
    .post("/patients/PATIENT-000001/records")
    .set("Authorization", `Bearer ${token(staff)}`)
    .send({
      category: "allergy",
      recordedOn: "2026-05-01",
      fields: { substance: "Penicillin", reaction: "Resolved" },
      priorRecordId: created.body.id
    });
  assert.equal(appended.status, 201);
  assert.equal(appended.body.versionIndex, 1);
  assert.equal(appended.body.recordRef, created.body.recordRef);
  assert.equal(rows[0].contentHash !== rows[1].contentHash, true);
  const listed = await request(app)
    .get("/patients/PATIENT-000001/records")
    .set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.records.length, 2);
  assert.equal(listed.body.records[0].content.reaction, "Rash");
  const anchor = await request(app)
    .post(`/patients/PATIENT-000001/records/${created.body.id}/anchor`)
    .set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(anchor.status, 403);
  assert.equal(anchor.body.error, "The hospital wallet cannot anchor a medical record. Patient consent is required.");
  assert.equal(calls.includes("submit"), false);
  assert.equal(calls.includes("controller"), false);
});

test("administrators, receptionists, and other hospitals cannot read or write clinical records", async () => {
  const { app } = harness();
  const body = { category: "visit", recordedOn: "2026-04-02", fields: { reason: "Follow-up" } };
  const desk = await request(app).post("/patients/PATIENT-000001/records").set("Authorization", `Bearer ${token(receptionist)}`).send(body);
  const administrator = await request(app).get("/patients/PATIENT-000001/records").set("Authorization", `Bearer ${adminToken()}`);
  const outside = await request(app)
    .post("/patients/PATIENT-000002/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send(body);
  assert.equal(desk.status, 403);
  assert.equal(administrator.status, 403);
  assert.equal(outside.status, 404);
});

function adminToken() {
  return token(admin);
}

test("a record hash does not contain the clinical text", () => {
  const hash = recordContentHash({ category: "diagnosis", condition: "Seasonal rhinitis", recordedOn: "2026-01-01" });
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.equal(hash.toLowerCase().includes("rhinitis"), false);
});
