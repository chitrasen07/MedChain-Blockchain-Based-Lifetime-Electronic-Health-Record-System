const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { createRuntime, readTrustProxy } = require("../src/server");

const secret = "test-secret-that-is-long-enough";
const piiKey = "11".repeat(32);
const ref = `0x${"ab".repeat(32)}`;
const baseEnv = {
  DATABASE_URL: "postgres://medchain_app:placeholder@localhost:5432/medchain",
  JWT_SECRET: secret,
  IDENTITY_COMMITMENT_KEY: "synthetic-identity",
  PII_ENCRYPTION_KEY: piiKey,
  BLOCKCHAIN_ENABLED: "false"
};

function harness(controller, { trustProxy = 1, demoDisableRateLimit = false } = {}) {
  const patients = {
    "PATIENT-000002": { id: "row-2", patientId: "PATIENT-000002", did: ref, hospital_id: "hospital-a", status: "confirmed" },
    "PATIENT-000003": { id: "row-3", patientId: "PATIENT-000003", did: ref, hospital_id: "hospital-a", status: "confirmed" }
  };
  const state = { challenge: null };
  const db = {
    async checkReady() {},
    async findConfirmedPatientForAuth(publicId) {
      return patients[publicId] || null;
    },
    async getPatientForAuth(id) {
      return Object.values(patients).find((patient) => patient.id === id) || null;
    },
    async createPatientChallenge(input) {
      state.challenge = { ...input, used: false };
    },
    async consumePatientChallenge(nonce) {
      if (!state.challenge || state.challenge.used || state.challenge.nonce !== nonce) return null;
      state.challenge.used = true;
      const patient = Object.values(patients).find((item) => item.id === state.challenge.patientId);
      return {
        patientId: state.challenge.patientId,
        walletAddress: state.challenge.walletAddress,
        message: state.challenge.message,
        publicPatientId: patient.patientId
      };
    }
  };
  const app = createApp({
    db,
    blockchain: { async getController() { return controller; } },
    config: { corsOrigin: false, jwtSecret: secret, piiEncryptionKey: piiKey, trustProxy, demoDisableRateLimit }
  });
  return app;
}

function post(app, path, body, forwardedFor) {
  const call = request(app).post(path).set("X-Forwarded-For", forwardedFor).send(body);
  return call;
}

test("production trusts one proxy hop and does not trust an open proxy setting", () => {
  assert.equal(readTrustProxy({ ...baseEnv, NODE_ENV: "production" }), 1);
  assert.equal(readTrustProxy({ ...baseEnv, RENDER: "true" }), 1);
  assert.equal(readTrustProxy({ ...baseEnv, TRUST_PROXY: "1" }), 1);
  assert.equal(readTrustProxy({ ...baseEnv, NODE_ENV: "production", TRUST_PROXY: "false" }), false);
  assert.equal(readTrustProxy(baseEnv), false);
  assert.equal(createRuntime({ ...baseEnv, NODE_ENV: "production" }).trustProxy, 1);
});

test("a correct wallet can sign in repeatedly without being rate limited", async () => {
  const owner = Wallet.createRandom();
  const app = harness(owner.address);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const challenge = await post(app, "/patient-auth/challenge", {
      patientId: "PATIENT-000002",
      walletAddress: owner.address
    }, "203.0.113.10");
    assert.equal(challenge.status, 200);
    const token = await post(app, "/patient-auth/token", {
      patientId: "PATIENT-000002",
      nonce: challenge.body.nonce,
      signature: await owner.signMessage(challenge.body.message)
    }, "203.0.113.10");
    assert.equal(token.status, 200);
  }
});

test("failed attempts for one patient do not block another patient or another address", async () => {
  const owner = Wallet.createRandom();
  const stranger = Wallet.createRandom();
  const app = harness(owner.address);
  let limited = null;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    limited = await post(app, "/patient-auth/challenge", {
      patientId: "PATIENT-000002",
      walletAddress: stranger.address
    }, "203.0.113.20");
  }
  assert.equal(limited.status, 429);
  assert.match(limited.headers["retry-after"], /^[1-9][0-9]*$/);
  assert.equal(limited.body.retryAfterSeconds, Number(limited.headers["retry-after"]));
  assert.match(limited.body.error, /Wait .+ and try again/);
  const otherPatient = await post(app, "/patient-auth/challenge", {
    patientId: "PATIENT-000003",
    walletAddress: stranger.address
  }, "203.0.113.20");
  const spoofed = await request(app).post("/patient-auth/challenge")
    .set("X-Forwarded-For", "198.51.100.9, 203.0.113.20")
    .send({ patientId: "PATIENT-000002", walletAddress: stranger.address });
  const otherAddress = await post(app, "/patient-auth/challenge", {
    patientId: "PATIENT-000002",
    walletAddress: stranger.address
  }, "203.0.113.21");
  const correct = await post(app, "/patient-auth/challenge", {
    patientId: "PATIENT-000002",
    walletAddress: owner.address
  }, "203.0.113.21");
  assert.equal(otherPatient.status, 401);
  assert.equal(spoofed.status, 429);
  assert.equal(otherAddress.status, 401);
  assert.equal(correct.status, 200);
});

test("the demo flag does not remove the patient sign-in limit", async () => {
  const owner = Wallet.createRandom();
  const app = harness(owner.address, { demoDisableRateLimit: true });
  let status = 0;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = await post(app, "/patient-auth/challenge", {
      patientId: "PATIENT-000002",
      walletAddress: owner.address.replace(/.$/, owner.address.endsWith("a") ? "b" : "a")
    }, "203.0.113.30");
    status = response.status;
  }
  assert.equal(status, 429);
});
