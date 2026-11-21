const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet, getAddress } = require("ethers");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");
const { encryptJson } = require("../src/crypto");
const { patientLoginMessage } = require("../src/patientAuth");

const secret = "test-secret-that-is-long-enough";
const piiKey = "11".repeat(32);
const ZERO = "0x0000000000000000000000000000000000000000";
const refA = `0x${"ab".repeat(32)}`;
const refB = `0x${"cd".repeat(32)}`;
const claim = `0x${"12".repeat(32)}`;

function harness(overrides = {}) {
  const calls = [];
  const state = {
    challenge: null,
    controllers: { [refA]: ZERO, [refB]: ZERO },
    visits: [],
    patients: [],
    ...overrides
  };
  const db = {
    async findConfirmedPatientForAuth(publicId) {
      calls.push("find");
      return state.patients.find((patient) => patient.patientId === publicId) || null;
    },
    async getPatientForAuth(id) {
      calls.push(["load", id]);
      return state.patients.find((patient) => patient.id === id) || null;
    },
    async getUserForAuth(id) {
      return state.staff && state.staff.id === id ? state.staff : null;
    },
    async createPatientChallenge(input) {
      calls.push("challenge");
      state.challenge = { ...input, used: false };
    },
    async consumePatientChallenge(nonce) {
      calls.push("consume");
      if (!state.challenge || state.challenge.used || state.challenge.nonce !== nonce) return null;
      state.challenge.used = true;
      const patient = state.patients.find((item) => item.id === state.challenge.patientId);
      return {
        patientId: state.challenge.patientId,
        walletAddress: state.challenge.walletAddress,
        message: state.challenge.message,
        publicPatientId: patient.patientId
      };
    },
    async listMedicalRecordsForPatient() {
      return [];
    },
    async listPatientVisits(id) {
      calls.push(["visits", id]);
      return state.visits.filter((visit) => visit.patientId === id);
    },
    async listConsentDoctors() {
      return state.doctors || [];
    }
  };
  const blockchain = {
    async getController(patientRef) {
      calls.push("controller");
      if (state.chainDown) throw Object.assign(new Error("rpc down"), { statusCode: 503 });
      return state.controllers[patientRef];
    },
    async submitRegistration() {
      calls.push("submit");
      throw new Error("broadcast");
    },
    async listConsent() {
      calls.push("consent");
      return [];
    },
    async listEmergency() {
      calls.push("emergency");
      return [];
    },
    async listAudit() {
      calls.push("audit");
      return [];
    },
    async hasChainRole(role, account) {
      calls.push("role");
      return Boolean(state.roles?.[`${role}:${String(account).toLowerCase()}`]);
    }
  };
  const app = createApp({
    db,
    blockchain,
    config: { corsOrigin: false, jwtSecret: secret, piiEncryptionKey: piiKey }
  });
  return { app, calls, state };
}

function patient(id, publicId, did, extra = {}) {
  return {
    id,
    patientId: publicId,
    did,
    status: "confirmed",
    hospital_id: "hospital-a",
    txHash: null,
    piiCiphertext: null,
    createdAt: "2026-11-20T00:00:00.000Z",
    registrationController: null,
    ...extra
  };
}

async function signIn(app, wallet, publicId) {
  const challenge = await request(app).post("/patient-auth/challenge").send({
    patientId: publicId,
    walletAddress: wallet.address
  });
  assert.equal(challenge.status, 200);
  const signature = await wallet.signMessage(challenge.body.message);
  const token = await request(app).post("/patient-auth/token").send({ nonce: challenge.body.nonce, signature });
  return { challenge, token };
}

test("a controller wallet receives a patient token and cannot replay it", async () => {
  const wallet = Wallet.createRandom();
  const { app, calls } = harness({
    controllers: { [refA]: wallet.address, [refB]: ZERO },
    patients: [patient("patient-a", "PATIENT-000001", refA), patient("patient-b", "PATIENT-000002", refB)]
  });
  const { challenge, token } = await signIn(app, wallet, "PATIENT-000001");
  assert.equal(challenge.body.message, patientLoginMessage({
    patientId: "PATIENT-000001",
    walletAddress: getAddress(wallet.address),
    nonce: challenge.body.nonce,
    expiresAt: challenge.body.expiresAt
  }));
  assert.equal(token.status, 200);
  const identity = await request(app).get("/patient-portal/identity").set("Authorization", `Bearer ${token.body.token}`);
  assert.equal(identity.status, 200);
  assert.equal(identity.body.patientId, "PATIENT-000001");
  assert.equal(identity.body.patientRef, refA);
  assert.equal(identity.body.ownership, "controller");
  assert.equal(Object.hasOwn(identity.body, "piiCiphertext"), false);
  const replay = await request(app).post("/patient-auth/token").send({
    nonce: challenge.body.nonce,
    signature: await wallet.signMessage(challenge.body.message)
  });
  assert.equal(replay.status, 401);
  assert.equal(calls.includes("submit"), false);
});

test("another wallet, a missing patient, and a chain outage are rejected without a challenge", async () => {
  const owner = Wallet.createRandom();
  const stranger = Wallet.createRandom();
  const owned = harness({
    controllers: { [refA]: owner.address },
    patients: [patient("patient-a", "PATIENT-000001", refA)]
  });
  const wrong = await request(owned.app).post("/patient-auth/challenge").send({
    patientId: "PATIENT-000001",
    walletAddress: stranger.address
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, "Patient sign-in could not be verified.");
  assert.equal(owned.calls.includes("challenge"), false);

  const missing = harness();
  const absent = await request(missing.app).post("/patient-auth/challenge").send({
    patientId: "PATIENT-000009",
    walletAddress: owner.address
  });
  assert.equal(absent.status, 401);
  assert.equal(missing.calls.includes("controller"), false);

  const down = harness({
    chainDown: true,
    controllers: { [refA]: owner.address },
    patients: [patient("patient-a", "PATIENT-000001", refA)]
  });
  const outage = await request(down.app).post("/patient-auth/challenge").send({
    patientId: "PATIENT-000001",
    walletAddress: owner.address
  });
  assert.equal(outage.status, 503);
  assert.equal(down.calls.includes("challenge"), false);
});

test("a signature from a different wallet is rejected and the challenge cannot be reused", async () => {
  const owner = Wallet.createRandom();
  const other = Wallet.createRandom();
  const { app } = harness({
    controllers: { [refA]: owner.address },
    patients: [patient("patient-a", "PATIENT-000001", refA)]
  });
  const challenge = await request(app).post("/patient-auth/challenge").send({
    patientId: "PATIENT-000001",
    walletAddress: owner.address
  });
  const forged = await request(app).post("/patient-auth/token").send({
    nonce: challenge.body.nonce,
    signature: await other.signMessage(challenge.body.message)
  });
  const reused = await request(app).post("/patient-auth/token").send({
    nonce: challenge.body.nonce,
    signature: await owner.signMessage(challenge.body.message)
  });
  assert.equal(forged.status, 401);
  assert.equal(reused.status, 401);
});

test("patient and staff tokens stay on their own routes", async () => {
  const wallet = Wallet.createRandom();
  const staff = { id: "staff-1", role: "administrator", hospital_id: "hospital-a", status: "active" };
  const { app, calls } = harness({
    staff,
    controllers: { [refA]: wallet.address },
    patients: [patient("patient-a", "PATIENT-000001", refA)],
    visits: [
      { id: "visit-a", patientId: "patient-a", recordReference: "visit-a-ref", recordHash: null, createdAt: "2026-11-20T01:00:00.000Z" },
      { id: "visit-b", patientId: "patient-b", recordReference: "visit-b-ref", recordHash: null, createdAt: "2026-11-20T02:00:00.000Z" }
    ]
  });
  const { token } = await signIn(app, wallet, "PATIENT-000001");
  const patientToken = token.body.token;
  const staffToken = issueToken(staff, secret);
  const portal = await request(app).get("/patient-portal/identity").set("Authorization", `Bearer ${staffToken}`);
  const users = await request(app).get("/admin/users").set("Authorization", `Bearer ${patientToken}`);
  const lookup = await request(app).get("/patients/PATIENT-000002").set("Authorization", `Bearer ${patientToken}`);
  const visits = await request(app).get("/patient-portal/visits").set("Authorization", `Bearer ${patientToken}`);
  const records = await request(app).get("/patient-portal/records").set("Authorization", `Bearer ${patientToken}`);
  const access = await request(app).get("/patient-portal/access").set("Authorization", `Bearer ${patientToken}`);
  const anonymous = await request(app).get("/patient-portal/identity");
  assert.equal(portal.status, 401);
  assert.equal(users.status, 401);
  assert.equal(lookup.status, 401);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(visits.body.visits.map((visit) => visit.recordReference), ["visit-a-ref"]);
  assert.equal(visits.body.medicalRecordRegistry, "consent_required");
  assert.deepEqual(records.body.records, []);
  assert.equal(records.body.anchoring, "disabled");
  assert.deepEqual(access.body.permissions, []);
  assert.deepEqual(access.body.emergency, []);
  assert.equal(access.body.grantingDisabled, false);
  assert.equal(access.body.broadcast, "disabled");
  assert.equal(access.body.status, "consent_required");
  assert.equal(calls.includes("submit"), false);
});

test("a recovery commitment can be checked without a secret, a token, or a transaction", async () => {
  const wallet = Wallet.createRandom();
  const { app, calls } = harness({
    controllers: { [refA]: ZERO },
    patients: [patient("patient-a", "PATIENT-000001", refA, { registrationController: `unclaimed:${claim}` })]
  });
  const leaked = await request(app).post("/patient-auth/claim-status").send({
    patientId: "PATIENT-000001",
    walletAddress: wallet.address,
    claimCommitment: claim,
    recoveryCode: `0x${"ab".repeat(32)}`
  });
  const status = await request(app).post("/patient-auth/claim-status").send({
    patientId: "PATIENT-000001",
    walletAddress: wallet.address,
    claimCommitment: claim
  });
  const mismatch = await request(app).post("/patient-auth/claim-status").send({
    patientId: "PATIENT-000001",
    walletAddress: wallet.address,
    claimCommitment: `0x${"99".repeat(32)}`
  });
  assert.equal(leaked.status, 400);
  assert.equal(leaked.body.error, "Do not send a recovery secret.");
  assert.equal(status.status, 200);
  assert.equal(status.body.status, "unclaimed");
  assert.equal(status.body.patientRef, refA);
  assert.equal(status.body.onChainClaim, "not_submitted");
  assert.equal(Object.hasOwn(status.body, "token"), false);
  assert.equal(mismatch.status, 401);
  assert.equal(calls.includes("submit"), false);
  assert.equal(calls.includes("challenge"), false);
});

test("a patient profile returns only that patient's decrypted fields", async () => {
  const wallet = Wallet.createRandom();
  const own = encryptJson({ fullName: "Synthetic Patient", dateOfBirth: "1990-01-01", secret: "do-not-copy" }, Buffer.from(piiKey, "hex"));
  const { app } = harness({
    controllers: { [refA]: wallet.address },
    patients: [patient("patient-a", "PATIENT-000001", refA, { piiCiphertext: own })]
  });
  const { token } = await signIn(app, wallet, "PATIENT-000001");
  const profile = await request(app).get("/patient-portal/profile").set("Authorization", `Bearer ${token.body.token}`);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.patientId, "PATIENT-000001");
  assert.deepEqual(profile.body.profile, { fullName: "Synthetic Patient", dateOfBirth: "1990-01-01" });
  assert.equal(JSON.stringify(profile.body).includes("do-not-copy"), false);
});

test("a patient can check an active doctor without seeing staff details or sending a transaction", async () => {
  const patientWallet = Wallet.createRandom();
  const doctor = Wallet.createRandom();
  const unauthorized = Wallet.createRandom();
  const stranger = Wallet.createRandom();
  const { app, calls } = harness({
    controllers: { [refA]: patientWallet.address },
    patients: [patient("patient-a", "PATIENT-000001", refA)],
    doctors: [
      { fullName: "Asha Verma", walletAddress: doctor.address, email: "doctor@medchain.test" },
      { fullName: "Pending Doctor", walletAddress: unauthorized.address, email: "pending@medchain.test" },
      { fullName: "Hidden", walletAddress: "not-a-wallet", email: "hidden@medchain.test" }
    ],
    roles: { [`DOCTOR:${doctor.address.toLowerCase()}`]: true }
  });
  const { token } = await signIn(app, patientWallet, "PATIENT-000001");
  const bearer = { Authorization: `Bearer ${token.body.token}` };
  const list = await request(app).get("/patient-portal/clinicians").set(bearer);
  const allowed = await request(app).post("/patient-portal/clinicians/authorization").set(bearer).send({ walletAddress: doctor.address });
  const chainDenied = await request(app).post("/patient-portal/clinicians/authorization").set(bearer).send({ walletAddress: unauthorized.address });
  const unknown = await request(app).post("/patient-portal/clinicians/authorization").set(bearer).send({ walletAddress: stranger.address });
  const anonymous = await request(app).get("/patient-portal/clinicians");
  assert.equal(list.status, 200);
  assert.equal(list.body.clinicians.length, 2);
  assert.equal(list.body.clinicians[0].name, "Asha Verma");
  assert.equal(list.body.clinicians[0].role, "Doctor");
  assert.equal(list.body.clinicians[0].walletAddress, doctor.address);
  assert.equal(JSON.stringify(list.body).includes("@"), false);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.walletAddress, doctor.address);
  assert.equal(chainDenied.status, 403);
  assert.equal(chainDenied.body.error, "This doctor is not authorized on Sepolia.");
  assert.equal(unknown.status, 403);
  assert.equal(unknown.body.error, "Choose an active doctor with a verified wallet.");
  assert.equal(anonymous.status, 401);
  assert.equal(calls.includes("submit"), false);
  assert.equal(calls.includes("role"), true);
});
