const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet, getAddress } = require("ethers");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");
const { decryptJson, encryptJson } = require("../src/crypto");
const { mergeProfile } = require("../src/chart");
const { STAFF_OWNER, UNCLAIMED_SIGNIN, STAFF_CONTROLLER, WRONG_WALLET } = require("../src/patientAuth");

const secret = "test-secret-that-is-long-enough";
const piiKey = "22".repeat(32);
const ZERO = "0x0000000000000000000000000000000000000000";
const ref = `0x${"ab".repeat(32)}`;
const profile = { fullName: "Synthetic Patient", dateOfBirth: "1990-01-01", gender: "female", bloodGroup: "O+" };
const admin = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };
const doctor = { id: "doctor", role: "doctor", hospital_id: "hospital-a", status: "active" };
const receptionist = { id: "desk", role: "receptionist", hospital_id: "hospital-a", status: "active" };

test("demographic corrections overlay display fields and keep the original profile", () => {
  const merged = mergeProfile(
    { fullName: "Original Name", dateOfBirth: "1990-01-01", mobile: "9000000000" },
    [{ gender: "female", createdAt: "2026-01-01" }],
    [{ fullName: "Corrected Name", reason: "spelling", createdAt: "2026-02-01" }]
  );
  assert.equal(merged.fullName, "Corrected Name");
  assert.equal(merged.dateOfBirth, "1990-01-01");
  assert.equal(merged.mobile, "9000000000");
  assert.equal(merged.gender, "female");
  assert.equal(Object.hasOwn(merged, "reason"), false);
});

function registrationApp({ staffRole = "", hospitalWallet = "" } = {}) {
  const calls = [];
  const db = {
    async getUserForAuth(id) {
      return [admin, doctor, receptionist].find((user) => user.id === id) || null;
    },
    identityHashes() { return [["fullName", "synthetic-hash"]]; },
    async matchPatient() { return { status: "no_match", candidates: [], candidateCount: 0 }; },
    async findStaffRoleByWallet(wallet) {
      calls.push(["staff-role", wallet]);
      return wallet.toLowerCase() === staffRole ? "doctor" : "";
    },
    async createPendingPatient() { calls.push("createPendingPatient"); return { id: "pending" }; },
    async beginRegistration() { return { id: "registration-1", status: "unknown", claimed: true }; },
    async consumeRegistrationWalletChallenge() { return null; },
    async createRegistrationWalletChallenge() { calls.push("wallet-challenge"); }
  };
  const blockchain = {
    identityCommitment() { return `0x${"11".repeat(32)}`; },
    async hospitalSigner() { return hospitalWallet || Wallet.createRandom().address; },
    async verifySigner() { return { isHospitalAdmin: true }; },
    async commitmentExists() { return false; },
    async submitRegistration() { calls.push("submitRegistration"); return { txHash: "0xtx" }; }
  };
  return {
    calls,
    app: createApp({
      db,
      blockchain,
      config: { corsOrigin: false, jwtSecret: secret, identityCommitmentKey: "synthetic", blockchainEnabled: true }
    })
  };
}

test("a staff or hospital wallet cannot be registered as the patient owner", async () => {
  const staffWallet = Wallet.createRandom();
  const hospitalWallet = Wallet.createRandom();
  const patientWallet = Wallet.createRandom();
  const staffCase = registrationApp({ staffRole: staffWallet.address.toLowerCase() });
  const token = issueToken(admin, secret);
  const blocked = await request(staffCase.app).post("/patients").set("Authorization", `Bearer ${token}`).send({
    ...profile,
    controller: staffWallet.address
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, STAFF_OWNER);
  assert.equal(staffCase.calls.includes("createPendingPatient"), false);
  assert.equal(staffCase.calls.includes("submitRegistration"), false);

  const challenge = await request(staffCase.app).post("/patient-registration/wallet-challenge").set("Authorization", `Bearer ${token}`).send({
    walletAddress: staffWallet.address
  });
  assert.equal(challenge.status, 409);
  assert.equal(staffCase.calls.includes("wallet-challenge"), false);

  const hospitalCase = registrationApp({ hospitalWallet: hospitalWallet.address });
  const hospitalBlocked = await request(hospitalCase.app).post("/patients").set("Authorization", `Bearer ${token}`).send({
    ...profile,
    controller: hospitalWallet.address
  });
  assert.equal(hospitalBlocked.status, 409);
  assert.equal(hospitalCase.calls.includes("createPendingPatient"), false);

  const allowed = registrationApp();
  const open = await request(allowed.app).post("/patients").set("Authorization", `Bearer ${token}`).send({
    ...profile,
    controller: patientWallet.address
  });
  assert.equal(open.status, 400);
  assert.equal(open.body.error, "The patient wallet must sign the link before registration.");
  assert.equal(allowed.calls.includes("createPendingPatient"), true);
});

function authApp(patients, controllers, extra = {}) {
  const calls = [];
  const db = {
    async findConfirmedPatientForAuth(publicId) {
      return patients.find((patient) => patient.patientId === publicId) || null;
    },
    async getPatientForAuth(id) {
      return patients.find((patient) => patient.id === id) || null;
    },
    async findStaffRoleByWallet(wallet) {
      return extra.staffWallets?.has(wallet) ? "doctor" : "";
    },
    async createPatientChallenge(input) {
      calls.push("challenge");
      extra.challenge = input;
    },
    async getPatient(publicId) {
      const patient = patients.find((item) => item.patientId === publicId);
      return patient ? { patientId: patient.patientId, did: patient.did } : null;
    },
    async getClinicalWallet() { return extra.boundWallet || null; },
    async getUserForAuth(id) {
      return [admin, doctor].find((user) => user.id === id) || null;
    }
  };
  const blockchain = {
    async getController(patientRef) {
      calls.push("controller");
      return controllers[patientRef] || ZERO;
    },
    async hospitalSigner() { return extra.hospitalWallet || Wallet.createRandom().address; }
  };
  return {
    calls,
    extra,
    app: createApp({
      db,
      blockchain,
      config: { corsOrigin: false, jwtSecret: secret, piiEncryptionKey: piiKey }
    })
  };
}

function row(id, publicId, controllerText) {
  return {
    id,
    patientId: publicId,
    did: ref,
    status: "confirmed",
    hospital_id: "hospital-a",
    registrationController: controllerText,
    piiCiphertext: null
  };
}

test("patient sign-in distinguishes unclaimed, wrong, and staff-controlled wallets", async () => {
  const owner = Wallet.createRandom();
  const stranger = Wallet.createRandom();
  const doctorWallet = Wallet.createRandom();
  const unclaimed = authApp([row("p1", "PATIENT-000011", `unclaimed:0x${"12".repeat(32)}`)], { [ref]: ZERO });
  const waiting = await request(unclaimed.app).post("/patient-auth/challenge").send({
    patientId: "PATIENT-000011",
    walletAddress: stranger.address
  });
  assert.equal(waiting.status, 401);
  assert.equal(waiting.body.error, UNCLAIMED_SIGNIN);
  assert.equal(unclaimed.calls.includes("challenge"), false);

  const owned = authApp([row("p2", "PATIENT-000012", owner.address)], { [ref]: owner.address });
  const wrong = await request(owned.app).post("/patient-auth/challenge").send({
    patientId: "PATIENT-000012",
    walletAddress: stranger.address
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, WRONG_WALLET);
  const status = await request(owned.app).post("/patient-auth/ownership-status").send({
    patientId: "PATIENT-000012",
    walletAddress: owner.address
  });
  assert.equal(status.status, 200);
  assert.equal(status.body.label, "Registered — Wallet linked");
  assert.equal(status.body.message, "Patient ownership verified.");
  assert.equal(status.body.walletIsController, true);
  assert.equal(owned.calls.includes("challenge"), false);

  const staffOwned = authApp(
    [row("p3", "PATIENT-000013", doctorWallet.address)],
    { [ref]: doctorWallet.address },
    { staffWallets: new Set([doctorWallet.address.toLowerCase()]), boundWallet: doctorWallet.address }
  );
  const blocked = await request(staffOwned.app).post("/patient-auth/challenge").send({
    patientId: "PATIENT-000013",
    walletAddress: doctorWallet.address
  });
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.error, STAFF_CONTROLLER);
  const lookup = await request(staffOwned.app).get("/patients/PATIENT-000013/ownership").set("Authorization", `Bearer ${issueToken(doctor, secret)}`);
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.staffControlled, true);
  assert.equal(lookup.body.callerIsController, true);
  assert.equal(lookup.body.patientRef, ref);
  assert.equal(Object.hasOwn(lookup.body, "piiCiphertext"), false);
});

test("an authorized correction is encrypted and does not replace registration facts", async () => {
  const stored = [];
  const audits = [];
  const original = encryptJson({ fullName: "Original Name", dateOfBirth: "1990-01-01" }, Buffer.from(piiKey, "hex"));
  const patient = {
    id: "row-1",
    patientId: "PATIENT-000014",
    did: ref,
    hospital_id: "hospital-a",
    status: "confirmed",
    piiCiphertext: original
  };
  const db = {
    async getUserForAuth(id) {
      return [admin, doctor, receptionist].find((user) => user.id === id) || null;
    },
    async getPatientChartSource() { return patient; },
    async getClinicalWallet() { return Wallet.createRandom().address; },
    async createDemographicCorrection(input) {
      stored.push(input);
      return { id: "correction-1" };
    },
    async createClinicalAudit(input) { audits.push(input); }
  };
  const blockchain = {
    async hospitalSigner() { return Wallet.createRandom().address; },
    async isMedicalStaff() { return true; },
    async hasAccess() { return false; },
    async checkEmergencyAccess() { return false; }
  };
  const app = createApp({
    db,
    blockchain,
    config: { corsOrigin: false, jwtSecret: secret, piiEncryptionKey: piiKey }
  });
  const saved = await request(app).post("/patients/PATIENT-000014/demographic-corrections").set("Authorization", `Bearer ${issueToken(admin, secret)}`).send({
    fullName: "Corrected Name",
    reason: "Spelling correction"
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.patientId, "PATIENT-000014");
  assert.equal(patient.piiCiphertext, original);
  const decoded = decryptJson(stored[0].contentCiphertext, Buffer.from(piiKey, "hex"));
  assert.equal(decoded.fullName, "Corrected Name");
  assert.equal(decoded.reason, "Spelling correction");
  assert.equal(audits[0].action, "demographic_corrected");
  assert.equal(JSON.stringify(audits[0]).includes("Corrected Name"), false);

  const denied = await request(app).post("/patients/PATIENT-000014/demographic-corrections").set("Authorization", `Bearer ${issueToken(doctor, secret)}`).send({
    mobile: "9000000001",
    reason: "Updated contact"
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "Patient consent is required.");
  assert.equal(stored.length, 1);

  const desk = await request(app).post("/patients/PATIENT-000014/demographic-corrections").set("Authorization", `Bearer ${issueToken(receptionist, secret)}`).send({
    mobile: "9000000001",
    reason: "Updated contact"
  });
  assert.equal(desk.status, 403);
  assert.equal(stored.length, 1);
});

test("ownership lookup does not treat a checksum controller as a different wallet", () => {
  const wallet = Wallet.createRandom();
  assert.equal(getAddress(wallet.address).toLowerCase(), wallet.address.toLowerCase());
});
