const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { issuePatientToken, issueToken } = require("../src/auth");

const secret = "test-secret-that-is-long-enough";
const piiKey = "22".repeat(32);
const doctor = { id: "doctor-1", role: "doctor", hospital_id: "hospital-a", status: "active" };
const staff = { id: "staff-1", role: "hospital_staff", hospital_id: "hospital-a", status: "active" };
const receptionist = { id: "desk-1", role: "receptionist", hospital_id: "hospital-a", status: "active" };
const patientRef = `0x${"ab".repeat(32)}`;

function token(user) {
  return issueToken(user, secret);
}

function harness() {
  const intakes = [];
  const records = [];
  const audits = [];
  const sessions = new Map();
  const challenges = new Map();
  const users = { [doctor.id]: doctor, [staff.id]: staff, [receptionist.id]: receptionist };
  const chain = { consent: new Set(), medical: new Set(), emergency: new Set(), hospital: Wallet.createRandom().address };
  const db = {
    async getUserForAuth(id) { return users[id] || null; },
    async getPatient(patientId, hospitalId) {
      if (patientId !== "PATIENT-000002" || hospitalId !== "hospital-a") return null;
      return { patientId, did: patientRef, status: "confirmed", hospital_id: hospitalId };
    },
    async getPatientChartSource(patientId, hospitalId) {
      const patient = await this.getPatient(patientId, hospitalId);
      if (!patient) return null;
      const { encryptJson } = require("../src/crypto");
      return {
        ...patient,
        id: "patient-row",
        piiCiphertext: encryptJson({
          fullName: "Amina Example",
          dateOfBirth: "1990-01-02",
          mobile: "5550100",
          gender: "Female"
        }, Buffer.from(piiKey, "hex")),
        createdAt: "2026-11-01T00:00:00.000Z"
      };
    },
    async createNursingIntake(input) {
      const row = {
        id: `22222222-2222-4222-8222-${String(intakes.length + 1).padStart(12, "0")}`,
        patientId: input.publicPatientId,
        hospitalId: input.hospitalId,
        kind: input.kind,
        status: "pending_review",
        contentCiphertext: input.contentCiphertext,
        contentHash: input.contentHash,
        createdAt: "2026-11-20T08:00:00.000Z",
        authorName: "Nurse Example"
      };
      intakes.push(row);
      return row;
    },
    async listNursingIntake(patientId, hospitalId) {
      return intakes.filter((row) => row.patientId === patientId && row.hospitalId === hospitalId);
    },
    async getNursingIntake(id, hospitalId) {
      return intakes.find((row) => row.id === id && row.hospitalId === hospitalId) || null;
    },
    async reviewNursingIntake(input) {
      const row = intakes.find((item) => item.id === input.id && item.hospitalId === input.hospitalId && item.status === "pending_review");
      if (!row) return null;
      row.status = input.status;
      row.promotedRecordId = input.promotedRecordId;
      row.reviewNoteCiphertext = input.reviewNoteCiphertext;
      return { id: row.id, status: row.status, promotedRecordId: row.promotedRecordId };
    },
    async listNursingQueue(hospitalId) {
      return intakes.filter((row) => row.hospitalId === hospitalId && row.status === "pending_review");
    },
    async listRecentPatients() {
      return [{ patientId: "PATIENT-000002", status: "confirmed", createdAt: "2026-11-01T00:00:00.000Z" }];
    },
    async createMedicalRecord(input) {
      const row = {
        id: `33333333-3333-4333-8333-${String(records.length + 1).padStart(12, "0")}`,
        ...input,
        chainStatus: "consent_required",
        publicPatientId: input.publicPatientId
      };
      records.push(row);
      return row;
    },
    async getMedicalRecord(id, hospitalId) {
      return records.find((row) => row.id === id && row.hospitalId === hospitalId) || null;
    },
    async createClinicalAudit(input) { audits.push(input); },
    async createClinicalChallenge(input) { challenges.set(input.nonce, input); },
    async consumeClinicalChallenge(nonce) {
      const challenge = challenges.get(nonce);
      if (!challenge || challenge.used) return null;
      challenge.used = true;
      return challenge;
    },
    async saveClinicalWallet(input) { sessions.set(input.userId, input.walletAddress); },
    async getClinicalWallet(userId) { return sessions.get(userId) || null; }
  };
  const blockchain = {
    async hospitalSigner() { return chain.hospital; },
    async isMedicalStaff(wallet) { return chain.medical.has(wallet.toLowerCase()); },
    async hasAccess(_patientRef, wallet) { return chain.consent.has(wallet.toLowerCase()); },
    async checkEmergencyAccess(_patientRef, wallet) { return chain.emergency.has(wallet.toLowerCase()); },
    async getController() { return "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; },
    async isActivePatient() { return true; },
    async hasChainRole(role, wallet) { return role === "DOCTOR" && chain.medical.has(String(wallet).toLowerCase()); },
    async recordVersionCount() { return 0; },
    async getAccessExpiry() { return 0; }
  };
  const app = createApp({
    db,
    blockchain,
    config: { corsOrigin: false, jwtSecret: secret, piiEncryptionKey: piiKey }
  });
  return { app, intakes, records, audits, chain };
}

async function bind(app, user, wallet) {
  const challenge = await request(app)
    .post("/clinical-wallet/challenge")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({ walletAddress: wallet.address });
  const session = await request(app)
    .post("/clinical-wallet/session")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({
      walletAddress: wallet.address,
      nonce: challenge.body.nonce,
      signature: await wallet.signMessage(challenge.body.message)
    });
  assert.equal(session.status, 200);
}

test("hospital staff record encrypted intake and cannot perform doctor actions", async () => {
  const doctorWallet = Wallet.createRandom();
  const { app, intakes, records, audits, chain } = harness();
  chain.medical.add(doctorWallet.address.toLowerCase());
  chain.consent.add(doctorWallet.address.toLowerCase());
  await bind(app, doctor, doctorWallet);

  const vital = await request(app)
    .post("/patients/PATIENT-000002/nursing-intake")
    .set("Authorization", `Bearer ${token(staff)}`)
    .send({
      kind: "vital",
      recordedOn: "2026-11-20",
      fields: { bloodPressure: "120/80", heartRate: "72", temperature: "36.8", spo2: "98", respiratoryRate: "16", height: "170", weight: "65", notes: "Resting" }
    });
  assert.equal(vital.status, 201);
  assert.equal(vital.body.label, "Pending doctor review");
  assert.equal(intakes[0].contentCiphertext.includes("120/80"), false);
  assert.equal(intakes[0].contentCiphertext.includes("Resting"), false);

  const visit = await request(app)
    .post("/patients/PATIENT-000002/nursing-intake")
    .set("Authorization", `Bearer ${token(staff)}`)
    .send({
      kind: "visit_note",
      recordedOn: "2026-11-20",
      fields: { checkInAt: "2026-11-20T09:00:00.000Z", reason: "Check-in", symptoms: "Headache", observations: "Alert" }
    });
  assert.equal(visit.status, 201);

  const lab = await request(app)
    .post("/patients/PATIENT-000002/nursing-intake")
    .set("Authorization", `Bearer ${token(staff)}`)
    .send({
      kind: "laboratory",
      recordedOn: "2026-11-20",
      fields: { testName: "Hemoglobin", result: "13.2", unit: "g/dL" }
    });
  assert.equal(lab.status, 201);
  assert.equal(lab.body.label, "Pending doctor review");

  const diagnosis = await request(app)
    .post("/patients/PATIENT-000002/records")
    .set("Authorization", `Bearer ${token(staff)}`)
    .send({ category: "diagnosis", recordedOn: "2026-11-20", fields: { condition: "Example" } });
  assert.equal(diagnosis.status, 403);
  const anchor = await request(app)
    .post(`/patients/PATIENT-000002/records/${lab.body.id}/anchor`)
    .set("Authorization", `Bearer ${token(staff)}`);
  assert.equal(anchor.status, 403);
  assert.equal(anchor.body.error, "Only a doctor can anchor a clinical record.");
  const reviewDenied = await request(app)
    .post(`/nursing-intake/${lab.body.id}/review`)
    .set("Authorization", `Bearer ${token(staff)}`)
    .send({ decision: "approve" });
  assert.equal(reviewDenied.status, 403);

  const queue = await request(app).get("/nursing/queue").set("Authorization", `Bearer ${token(staff)}`);
  assert.equal(queue.status, 200);
  assert.equal(queue.body.pendingLabs.length, 1);
  assert.equal(JSON.stringify(queue.body).includes("Hemoglobin"), false);
  assert.equal(JSON.stringify(queue.body).includes("120/80"), false);
  assert.equal(queue.body.recentPatients[0].patientId, "PATIENT-000002");

  const summary = await request(app)
    .get("/patients/PATIENT-000002/staff-summary")
    .set("Authorization", `Bearer ${token(staff)}`);
  assert.equal(summary.status, 200);
  assert.equal(summary.body.demographics.fullName, "Amina Example");
  assert.equal(Object.hasOwn(summary.body.demographics, "mobile"), false);
  assert.equal(summary.body.visits[0].content.reason, "Check-in");
  assert.equal(JSON.stringify(summary.body).includes("5550100"), false);

  const hidden = await request(app)
    .get("/patients/PATIENT-000002/nursing-intake")
    .set("Authorization", `Bearer ${token(doctor)}`);
  chain.consent.delete(doctorWallet.address.toLowerCase());
  const denied = await request(app)
    .get("/patients/PATIENT-000002/nursing-intake")
    .set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(hidden.status, 200);
  assert.equal(denied.status, 403);
  chain.consent.add(doctorWallet.address.toLowerCase());

  const approved = await request(app)
    .post(`/nursing-intake/${lab.body.id}/review`)
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ decision: "approve" });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.label, "Reviewed");
  assert.equal(records.length, 1);
  assert.equal(records[0].category, "laboratory");
  assert.equal(records[0].workflowStatus, "reviewed");
  assert.equal(records[0].contentCiphertext.includes("Hemoglobin"), false);
  assert.equal(records[0].contentCiphertext.includes("13.2"), false);
  const again = await request(app)
    .post(`/nursing-intake/${lab.body.id}/review`)
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ decision: "approve" });
  assert.equal(again.status, 409);
  assert.equal(records.length, 1);

  const rejected = await request(app)
    .post(`/nursing-intake/${vital.body.id}/review`)
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ decision: "reject", note: "Repeat the measurement" });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.label, "Rejected");
  assert.equal(records.length, 1);
  assert.equal(intakes.find((row) => row.id === vital.body.id).reviewNoteCiphertext.includes("Repeat"), false);

  const missingReason = await request(app)
    .post("/patients/PATIENT-000002/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({
      category: "laboratory",
      recordedOn: "2026-11-20",
      fields: { testName: "Hemoglobin", result: "13.4" },
      priorRecordId: records[0].id
    });
  assert.equal(missingReason.status, 400);
  const corrected = await request(app)
    .post("/patients/PATIENT-000002/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({
      category: "laboratory",
      recordedOn: "2026-11-20",
      fields: { testName: "Hemoglobin", result: "13.4" },
      priorRecordId: records[0].id,
      correctionReason: "Updated laboratory value"
    });
  assert.equal(corrected.status, 201);
  assert.equal(corrected.body.versionIndex, 1);
  assert.equal(records[0].contentCiphertext, records[0].contentCiphertext);

  const draft = await request(app)
    .post("/patients/PATIENT-000002/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({
      category: "diagnosis",
      recordedOn: "2026-11-20",
      fields: { condition: "Observation" },
      workflowStatus: "draft"
    });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.workflowStatus, "draft");
  const draftAnchor = await request(app)
    .post(`/patients/PATIENT-000002/records/${draft.body.id}/anchor`)
    .set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(draftAnchor.status, 403);
  assert.match(draftAnchor.body.error, /not ready to anchor/);

  const desk = await request(app)
    .post("/patients/PATIENT-000002/nursing-intake")
    .set("Authorization", `Bearer ${token(receptionist)}`)
    .send({ kind: "vital", recordedOn: "2026-11-20", fields: { heartRate: "70" } });
  assert.equal(desk.status, 403);
  const other = await request(app)
    .post("/patients/PATIENT-000099/nursing-intake")
    .set("Authorization", `Bearer ${token(staff)}`)
    .send({ kind: "vital", recordedOn: "2026-11-20", fields: { heartRate: "70" } });
  assert.equal(other.status, 404);
  const patientToken = issuePatientToken(
    { id: "patient-row", hospital_id: "hospital-a", did: patientRef, status: "confirmed" },
    doctorWallet.address,
    secret
  );
  const patientRead = await request(app)
    .get("/patients/PATIENT-000002/nursing-intake")
    .set("Authorization", `Bearer ${patientToken}`);
  assert.equal(patientRead.status, 401);

  const staffRegister = await request(app).post("/patients").set("Authorization", `Bearer ${token(staff)}`).send({});
  const doctorRegister = await request(app).post("/patients").set("Authorization", `Bearer ${token(doctor)}`).send({});
  assert.equal(staffRegister.status, 400);
  assert.equal(doctorRegister.status, 403);
  assert.equal(audits.some((event) => event.action === "intake_created" && JSON.stringify(event).includes("120/80")), false);
  assert.equal(audits.some((event) => event.action === "intake_reviewed"), true);
  assert.equal(audits.some((event) => event.action === "intake_rejected"), true);
  assert.equal(audits.some((event) => event.action === "record_corrected"), true);
});
