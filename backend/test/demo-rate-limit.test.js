const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
const { createRuntime } = require("../src/server");

const baseEnv = {
  DATABASE_URL: "postgres://medchain_app:placeholder@localhost:5432/medchain",
  JWT_SECRET: "test-secret-that-is-long-enough",
  IDENTITY_COMMITMENT_KEY: "synthetic-identity",
  PII_ENCRYPTION_KEY: "11".repeat(32),
  BLOCKCHAIN_ENABLED: "false"
};

function appFor(demoDisableRateLimit) {
  return createApp({
    db: { async checkReady() {} },
    blockchain: {},
    config: { corsOrigin: false, jwtSecret: baseEnv.JWT_SECRET, demoDisableRateLimit }
  });
}

async function statuses(app, path, count) {
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const response = await request(app).post(path).send({});
    results.push(response.status);
  }
  return results;
}

test("the demo rate-limit flag is enabled only by the exact true value", () => {
  assert.equal(createRuntime(baseEnv).demoDisableRateLimit, false);
  assert.equal(createRuntime({ ...baseEnv, DEMO_DISABLE_RATE_LIMIT: "false" }).demoDisableRateLimit, false);
  assert.equal(createRuntime({ ...baseEnv, DEMO_DISABLE_RATE_LIMIT: "true" }).demoDisableRateLimit, true);
  assert.equal(createRuntime({ ...baseEnv, DEMO_DISABLE_RATE_LIMIT: "yes" }).demoDisableRateLimit, false);
});

test("demo mode skips patient login, wallet challenges, and recovery checks", async () => {
  const app = appFor(true);
  const paths = [
    "/patient-auth/challenge",
    "/patient-auth/token",
    "/patient-auth/claim-status",
    "/clinical-wallet/challenge",
    "/clinical-wallet/session",
    "/patient-registration/wallet-challenge",
    "/admin/staff-wallet/challenge"
  ];
  for (const path of paths) {
    const results = await statuses(app, path, 12);
    assert.equal(results.includes(429), false, path);
  }
});

test("patient login stays limited when the demo flag is off", async () => {
  const results = await statuses(appFor(false), "/patient-auth/challenge", 12);
  assert.equal(results.includes(429), true);
});

test("staff sign-in and password changes stay limited during the demo", async () => {
  const app = appFor(true);
  const signIn = await statuses(app, "/auth/token", 12);
  const password = await statuses(app, "/auth/password", 6);
  assert.equal(signIn.includes(429), true);
  assert.equal(password.includes(429), true);
});
