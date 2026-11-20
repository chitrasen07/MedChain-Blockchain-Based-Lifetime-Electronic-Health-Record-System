const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");
const { decryptJson } = require("../src/crypto");
const { recordContentHash } = require("../src/clinicalRecords");
const { anchorCalldata, emergencyCalldata, reasonHash } = require("../src/consentChain");

const secret = "test-secret-that-is-long-enough";
const piiKey = "22".repeat(32);
const doctor = { id: "doctor-1", role: "doctor", hospital_id: "hospital-a", status: "active" };
const staff = { id: "staff-1", role: "hospital_staff", hospital_id: "hospital-a", status: "active" };
const receptionist = { id: "desk-1", role: "receptionist", hospital_id: "hospital-a", status: "active" };
const admin = { id: "admin-1", role: "administrator", hospital_id: "hospital-a", status: "active" };
const patientRef = `0x${"ab".repeat(32)}`;

function token(user) {
  return issueToken(user, secret);
}

function harness(state = {}) {
  const calls = [];
  const rows = [];
  const audits = [];
  const challenges = new Map();
  const sessions = new Map();
  const users = {
    [doctor.id]: doctor,
    [staff.id]: staff,
    [receptionist.id]: receptionist,
    [admin.id]: admin
  };
  const chain = {
    hospital: Wallet.createRandom().address,
    consent: new Set(),
    emergency: new Set(),
    medical: new Set(),
    responder: new Set(),
    cooldown: new Set(),
    ...state
  };
  const db = {
    async getUserForAuth(id) {
      return users[id] || null;
    },
    async getPatient(patientId, hospitalId) {
      calls.push(["patient", patientId, hospitalId]);
      if (patientId !== "PATIENT-000001" || hospitalId !== "hospital-a") return null;
      return { patientId, did: patientRef, status: "confirmed" };
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
      return rows.filter((row) => row.publicPatientId === patientId && row.hospitalId === hospitalId);
    },
    async createClinicalChallenge(input) {
      challenges.set(input.nonce, { ...input, used: false });
    },
    async consumeClinicalChallenge(nonce) {
      const challenge = challenges.get(nonce);
      if (!challenge || challenge.used) return null;
      challenge.used = true;
      return challenge;
    },
    async saveClinicalWallet(input) {
      sessions.set(input.userId, input.walletAddress);
    },
    async getClinicalWallet(userId) {
      return sessions.get(userId) || null;
    },
    async createAccessAudit(input) {
      calls.push("audit");
      audits.push(input);
      return { id: "audit-1" };
    },
    async listAccessAuditForHospital() {
      return audits;
    }
  };
  const blockchain = {
    async hospitalSigner() {
      return chain.hospital;
    },
    async isMedicalStaff(wallet) {
      return chain.medical.has(wallet.toLowerCase());
    },
    async isEmergencyResponder(wallet) {
      return chain.responder.has(wallet.toLowerCase());
    },
    async hasAccess(_patientRef, wallet) {
      calls.push("hasAccess");
      return chain.consent.has(wallet.toLowerCase());
    },
    async checkEmergencyAccess(_patientRef, wallet) {
      calls.push("emergency");
      return chain.emergency.has(wallet.toLowerCase());
    },
    async emergencyCooldown(_patientRef, wallet) {
      return chain.cooldown.has(wallet.toLowerCase());
    },
    async listEmergency() {
      return [];
    },
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
  return { app, calls, rows, audits, chain };
}

async function bind(app, user, wallet) {
  const challenge = await request(app)
    .post("/clinical-wallet/challenge")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({ walletAddress: wallet.address });
  assert.equal(challenge.status, 200);
  const session = await request(app)
    .post("/clinical-wallet/session")
    .set("Authorization", `Bearer ${token(user)}`)
    .send({
      walletAddress: wallet.address,
      nonce: challenge.body.nonce,
      signature: await wallet.signMessage(challenge.body.message)
    });
  assert.equal(session.status, 200);
  assert.equal(session.body.walletAddress, wallet.address);
}

test("consented clinical staff store an encrypted record and cannot broadcast the anchor", async () => {
  const doctorWallet = Wallet.createRandom();
  const staffWallet = Wallet.createRandom();
  const { app, calls, rows, chain } = harness();
  chain.medical.add(doctorWallet.address.toLowerCase());
  chain.medical.add(staffWallet.address.toLowerCase());
  chain.consent.add(doctorWallet.address.toLowerCase());
  chain.consent.add(staffWallet.address.toLowerCase());
  await bind(app, doctor, doctorWallet);
  await bind(app, staff, staffWallet);
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
  assert.equal(created.body.access, "consent");
  assert.equal(created.body.content.substance, "Penicillin");
  assert.equal(rows[0].contentCiphertext.includes("Penicillin"), false);
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
  const anchor = await request(app)
    .post(`/patients/PATIENT-000001/records/${created.body.id}/anchor`)
    .set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(anchor.status, 200);
  assert.equal(anchor.body.broadcast, "disabled");
  assert.equal(anchor.body.transaction, null);
  assert.equal(anchor.body.data, anchorCalldata({
    versionIndex: 0,
    recordRef: created.body.recordRef,
    patientRef,
    contentHash: created.body.contentHash
  }));
  assert.equal(anchor.body.data.toLowerCase().includes(Buffer.from("Penicillin").toString("hex")), false);
  assert.equal(calls.includes("submit"), false);
  assert.equal(calls.includes("controller"), false);
});

test("missing, expired, and hospital-wallet authority cannot read or anchor a chart", async () => {
  const doctorWallet = Wallet.createRandom();
  const { app, calls, chain } = harness();
  chain.medical.add(doctorWallet.address.toLowerCase());
  const unbound = await request(app)
    .post("/patients/PATIENT-000001/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ category: "allergy", recordedOn: "2026-04-01", fields: { substance: "Penicillin" } });
  assert.equal(unbound.status, 403);
  assert.equal(unbound.body.error, "Connect the clinical wallet that holds patient consent.");
  await bind(app, doctor, doctorWallet);
  const denied = await request(app)
    .get("/patients/PATIENT-000001/records")
    .set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "Patient consent is required.");
  const anchor = await request(app)
    .post("/patients/PATIENT-000001/records/11111111-1111-4111-8111-000000000001/anchor")
    .set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(anchor.status, 403);
  assert.equal(anchor.body.error, "The hospital wallet cannot anchor a medical record. Patient consent is required.");
  chain.consent.add(chain.hospital.toLowerCase());
  chain.medical.add(chain.hospital.toLowerCase());
  const blocked = await request(app)
    .post("/clinical-wallet/challenge")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ walletAddress: chain.hospital });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, "The hospital signing wallet cannot grant, revoke, or use patient consent.");
  assert.equal(calls.includes("submit"), false);
  assert.equal(calls.includes("create"), false);
});

test("emergency access is bounded, hashed, and cannot reveal the rest of the chart", async () => {
  const doctorWallet = Wallet.createRandom();
  const { app, calls, audits, chain } = harness();
  chain.medical.add(doctorWallet.address.toLowerCase());
  chain.responder.add(doctorWallet.address.toLowerCase());
  chain.emergency.add(doctorWallet.address.toLowerCase());
  chain.consent.add(doctorWallet.address.toLowerCase());
  await bind(app, doctor, doctorWallet);
  await request(app)
    .post("/patients/PATIENT-000001/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ category: "visit", recordedOn: "2026-04-02", fields: { reason: "Admission note" } });
  chain.consent.delete(doctorWallet.address.toLowerCase());
  const hidden = await request(app)
    .get("/patients/PATIENT-000001/records")
    .set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.access, "emergency");
  assert.equal(hidden.body.records.length, 0);
  const narrative = await request(app)
    .post("/patients/PATIENT-000001/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ category: "treatment", recordedOn: "2026-04-03", fields: { treatment: "Observation" } });
  assert.equal(narrative.status, 403);
  assert.equal(narrative.body.error, "Emergency access is limited to necessary medical information.");
  const reason = "Unconscious patient needs the allergy list";
  chain.cooldown.add(doctorWallet.address.toLowerCase());
  const cooling = await request(app)
    .post("/patients/PATIENT-000001/emergency-access")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ reason, durationSeconds: 3600 });
  assert.equal(cooling.status, 403);
  chain.cooldown.delete(doctorWallet.address.toLowerCase());
  const prepared = await request(app)
    .post("/patients/PATIENT-000001/emergency-access")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ reason, durationSeconds: 72 * 60 * 60 });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.broadcast, "disabled");
  assert.equal(prepared.body.transaction, null);
  assert.equal(prepared.body.reasonHash, reasonHash(reason));
  assert.equal(prepared.body.data, emergencyCalldata(patientRef, reason, 72 * 60 * 60));
  assert.equal(prepared.body.data.toLowerCase().includes("unconscious"), false);
  assert.equal(audits[0].reasonCiphertext.includes("Unconscious"), false);
  assert.equal(calls.includes("submit"), false);
  const tooLong = await request(app)
    .post("/patients/PATIENT-000001/emergency-access")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ reason, durationSeconds: 72 * 60 * 60 + 1 });
  assert.equal(tooLong.status, 400);
});

test("administrators, receptionists, and other hospitals cannot read or write clinical records", async () => {
  const { app } = harness();
  const body = { category: "visit", recordedOn: "2026-04-02", fields: { reason: "Follow-up" } };
  const desk = await request(app).post("/patients/PATIENT-000001/records").set("Authorization", `Bearer ${token(receptionist)}`).send(body);
  const administrator = await request(app).get("/patients/PATIENT-000001/records").set("Authorization", `Bearer ${token(admin)}`);
  const outside = await request(app)
    .post("/patients/PATIENT-000002/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send(body);
  assert.equal(desk.status, 403);
  assert.equal(administrator.status, 403);
  assert.equal(outside.status, 404);
});

test("a record hash does not contain the clinical text", () => {
  const hash = recordContentHash({ category: "diagnosis", condition: "Seasonal rhinitis", recordedOn: "2026-01-01" });
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.equal(hash.toLowerCase().includes("rhinitis"), false);
});

test("a reused clinical wallet challenge is rejected", async () => {
  const doctorWallet = Wallet.createRandom();
  const { app, chain } = harness();
  chain.medical.add(doctorWallet.address.toLowerCase());
  const challenge = await request(app)
    .post("/clinical-wallet/challenge")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ walletAddress: doctorWallet.address });
  const signature = await doctorWallet.signMessage(challenge.body.message);
  const first = await request(app)
    .post("/clinical-wallet/session")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ walletAddress: doctorWallet.address, nonce: challenge.body.nonce, signature });
  const second = await request(app)
    .post("/clinical-wallet/session")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ walletAddress: doctorWallet.address, nonce: challenge.body.nonce, signature });
  assert.equal(first.status, 200);
  assert.equal(second.status, 401);
});
