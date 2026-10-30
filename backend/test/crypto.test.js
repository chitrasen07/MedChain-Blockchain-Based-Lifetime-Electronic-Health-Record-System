const test = require("node:test");
const assert = require("node:assert/strict");
const { fieldHash, encryptJson, decryptJson, requiredKey } = require("../src/crypto");

test("normalization makes equivalent profile values match", () => {
  const secret = Buffer.from("test-secret");
  assert.equal(fieldHash(secret, "fullName", "  Ada  Lovelace "), fieldHash(secret, "fullName", "ada lovelace"));
  assert.notEqual(fieldHash(secret, "fullName", "Ada Lovelace"), fieldHash(secret, "email", "Ada Lovelace"));
});

test("PII encryption round trips without exposing plaintext in ciphertext", () => {
  const key = requiredKey("11".repeat(32), "PII_ENCRYPTION_KEY", 32);
  const profile = { fullName: "Synthetic Patient", dateOfBirth: "1990-01-01" };
  const encrypted = encryptJson(profile, key);
  assert.equal(encrypted.includes(profile.fullName), false);
  assert.deepEqual(decryptJson(encrypted, key), profile);
});
