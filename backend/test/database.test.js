const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { createDb } = require("../src/db");
const { migrationFiles } = require("../src/migrate");
const path = require("node:path");
const request = require("supertest");

test("database configuration requires an explicit connection string", () => {
  assert.throws(
    () => createDb({ piiEncryptionKey: "11".repeat(32), identityCommitmentKey: "test" }),
    /DATABASE_URL is required/
  );
});

test("readiness reports a dependency failure as 503", async () => {
  const app = createApp({
    db: { async checkReady() { throw new Error("database unavailable"); } },
    blockchain: {},
    config: { corsOrigin: false, jwtSecret: "test-secret" }
  });
  const response = await request(app).get("/ready");
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: "Service unavailable" });
});

test("migration files are ordered and versioned by filename", async () => {
  const files = await migrationFiles(path.join(__dirname, "..", "migrations"));
  assert.deepEqual(files, [
    "001_initial.sql",
    "002_hospital_authorization.sql",
    "003_matching_review_workflow.sql",
    "004_registration_transactions.sql"
  ]);
});
