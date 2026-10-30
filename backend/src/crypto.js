const crypto = require("node:crypto");

function requiredKey(value, name, bytes) {
  if (!value) throw new Error(`${name} is required`);
  const key = Buffer.from(value, "hex");
  if (key.length !== bytes) throw new Error(`${name} must be ${bytes * 2} hex characters`);
  return key;
}

function normalize(value) {
  return String(value || "").trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
}

function fieldHash(secret, field, value) {
  return crypto.createHmac("sha256", secret).update(`${field}:${normalize(value)}`).digest("hex");
}

function encryptJson(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptJson(value, key) {
  const [iv, tag, ciphertext] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 32);
  return `${salt.toString("base64url")}.${derived.toString("base64url")}`;
}

function verifyPassword(password, encoded) {
  const [saltText, hashText] = encoded.split(".");
  if (!saltText || !hashText) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltText, "base64url"), 32);
  const expected = Buffer.from(hashText, "base64url");
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { requiredKey, normalize, fieldHash, encryptJson, decryptJson, hashPassword, verifyPassword };
