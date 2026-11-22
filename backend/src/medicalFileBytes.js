const crypto = require("node:crypto");

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CATEGORIES = new Set(["xray", "blood_test", "mri_ct", "ecg", "prescription", "other"]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fileEncryptionKey(piiKey) {
  return Buffer.from(crypto.hkdfSync("sha256", piiKey, Buffer.from("medchain.medical-files"), Buffer.from("v1"), 32));
}

function encryptBytes(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}

function decryptBytes(envelope, key) {
  if (!Buffer.isBuffer(envelope) || envelope.length < 30 || envelope[0] !== 1) {
    throw Object.assign(new Error("Stored medical file could not be read"), { statusCode: 500 });
  }
  const iv = envelope.subarray(1, 13);
  const tag = envelope.subarray(13, 29);
  const ciphertext = envelope.subarray(29);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function detectFile(buffer, maxBytes = MAX_FILE_BYTES) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { error: "type" };
  if (buffer.length > maxBytes) return { error: "size" };
  if (buffer.length >= PNG.length && buffer.subarray(0, PNG.length).equals(PNG)) return { contentType: "image/png" };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { contentType: "image/jpeg" };
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return { contentType: "application/pdf" };
  return { error: "type" };
}

function safeFilename(raw) {
  let value = String(raw || "");
  try { value = decodeURIComponent(value); } catch { return null; }
  value = value.replace(/[\u0000-\u001f\u007f]/g, "");
  const base = value.split(/[\\/]/).filter(Boolean).pop() || "";
  const cleaned = base.trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  return cleaned.slice(0, 180);
}

function extensionMatches(filename, contentType) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return true;
  if (contentType === "application/pdf") return match[1] === "pdf";
  if (contentType === "image/png") return match[1] === "png";
  return match[1] === "jpg" || match[1] === "jpeg";
}

function safeDescription(raw) {
  if (raw == null || raw === "") return "";
  let value = String(raw);
  try { value = decodeURIComponent(value); } catch { return null; }
  value = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
  if (value.length > 500) return null;
  return value;
}

function storageKey() {
  return `v1/${crypto.randomUUID()}`;
}

function validStorageKey(key) {
  return /^v1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key || "");
}

function contentDisposition(intent, filename) {
  const kind = intent === "preview" ? "inline" : "attachment";
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

module.exports = {
  MAX_FILE_BYTES,
  CATEGORIES,
  fileEncryptionKey,
  encryptBytes,
  decryptBytes,
  detectFile,
  safeFilename,
  extensionMatches,
  safeDescription,
  storageKey,
  validStorageKey,
  contentDisposition
};
