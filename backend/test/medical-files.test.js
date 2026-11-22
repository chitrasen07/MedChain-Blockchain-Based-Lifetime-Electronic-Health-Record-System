const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { issueToken, issuePatientToken } = require("../src/auth");
const { createMemoryFileStore, createS3FileStore, readFileStorage } = require("../src/fileStore");
const { detectFile, encryptBytes, decryptBytes, fileEncryptionKey, safeFilename } = require("../src/medicalFileBytes");

const secret = "test-secret-that-is-long-enough";
const piiKey = "22".repeat(32);
const hospitalId = "hospital-a";
const doctorId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const patientRowId = "33333333-3333-4333-8333-333333333333";
const otherPatientRowId = "44444444-4444-4444-8444-444444444444";
const patientRef = `0x${"ab".repeat(32)}`;
const wallet = "0x6119546CBab8813aCf1c9B1ACa502f9485805A46";
const marker = "PLAINTEXT-MARKER-XRAY";
const note = "UNIQUE-CLINICAL-NOTE-8841";
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(marker)
]);

function patient(id, publicId) {
  return { id, patientId: publicId, did: patientRef, status: "confirmed", hospital_id: hospitalId };
}

test("recognizes PDF, JPEG, and PNG bytes and encrypts them", () => {
  assert.equal(detectFile(png).contentType, "image/png");
  assert.equal(detectFile(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("scan")])).contentType, "image/jpeg");
  assert.equal(detectFile(Buffer.from("%PDF-1.7 report")).contentType, "application/pdf");
  assert.equal(detectFile(Buffer.from("<html>no</html>")).error, "type");
  assert.equal(detectFile(png, 4).error, "size");
  assert.equal(safeFilename(encodeURIComponent("../../secret-xray.png")), "secret-xray.png");
  const key = fileEncryptionKey(Buffer.from(piiKey, "hex"));
  const envelope = encryptBytes(png, key);
  assert.equal(envelope.includes(Buffer.from(marker)), false);
  assert.equal(decryptBytes(envelope, key).equals(png), true);
});

test("signs a private object upload without publishing the file", async () => {
  assert.equal(readFileStorage({}), null);
  assert.throws(() => readFileStorage({ MEDICAL_FILE_S3_BUCKET: "medical-files" }), /together/);
  let captured;
  const store = createS3FileStore({
    bucket: "medical-files",
    region: "auto",
    endpoint: "https://example.r2.cloudflarestorage.com",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key"
  }, async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
  });
  const body = Buffer.from("ciphertext-not-the-report");
  await store.put("v1/33333333-3333-4333-8333-333333333333", body);
  assert.equal(captured.url, "https://example.r2.cloudflarestorage.com/medical-files/v1/33333333-3333-4333-8333-333333333333");
  assert.equal(captured.options.headers["x-amz-acl"], undefined);
  assert.equal(captured.options.headers.authorization.includes("secret-key"), false);
  assert.equal(Buffer.from(captured.options.body).equals(body), true);
  await assert.rejects(store.put("../secret", body));
});

test("patients and consented doctors use private medical files", async () => {
  const patients = {
    [patientRowId]: patient(patientRowId, "PATIENT-000010"),
    [otherPatientRowId]: patient(otherPatientRowId, "PATIENT-000011")
  };
  const users = {
    [doctorId]: { id: doctorId, role: "doctor", hospital_id: hospitalId, status: "active", token_version: 0 },
    [adminId]: { id: adminId, role: "administrator", hospital_id: hospitalId, status: "active", token_version: 0 }
  };
  const files = [];
  const audits = [];
  let consent = false;
  const doctorWallet = Wallet.createRandom();
  const hospitalWallet = Wallet.createRandom();
  const db = {
    async getUserForAuth(id) { return users[id] || null; },
    async getPatientForAuth(id) { return patients[id] || null; },
    async getPatientChartSource(publicId, hospital) {
      return Object.values(patients).find((item) => item.patientId === publicId && item.hospital_id === hospital) || null;
    },
    async getClinicalWallet() { return doctorWallet.address; },
    async getStaffName() { return "Dr Sharma"; },
    async createMedicalFile(input) {
      const row = { id: crypto.randomUUID(), createdAt: "2026-11-22T05:00:00.000Z", ...input };
      files.push(row);
      return { id: row.id, createdAt: row.createdAt };
    },
    async listMedicalFiles(id, hospital) {
      return files.filter((row) => row.patientId === id && row.hospitalId === hospital);
    },
    async getMedicalFile(id, patientId, hospital) {
      return files.find((row) => row.id === id && row.patientId === patientId && row.hospitalId === hospital) || null;
    },
    async recordActivity(event) {
      audits.push(event);
      return { id: audits.length };
    }
  };
  const blockchain = {
    async hospitalSigner() { return hospitalWallet.address; },
    async isMedicalStaff() { return true; },
    async hasAccess() { return consent; },
    async checkEmergencyAccess() { return false; }
  };
  const store = createMemoryFileStore();
  const config = { jwtSecret: secret, piiEncryptionKey: piiKey, trustProxy: false };
  const closed = createApp({ db, blockchain, config });
  const app = createApp({ db, blockchain, config, fileStore: store, maxFileBytes: 64 });
  const patientToken = issuePatientToken(patients[patientRowId], wallet, secret);
  const otherToken = issuePatientToken(patients[otherPatientRowId], wallet, secret);
  const doctorToken = issueToken(users[doctorId], secret);
  const adminToken = issueToken(users[adminId], secret);
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  const unconfigured = await request(closed)
    .post("/patient-portal/files")
    .set(auth(patientToken))
    .set("Content-Type", "application/octet-stream")
    .set("X-Medchain-Filename", encodeURIComponent("xray.png"))
    .set("X-Medchain-Category", "xray")
    .send(png);
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.body.error, "Medical file storage is not configured.");

  const uploaded = await request(app)
    .post("/patient-portal/files")
    .set(auth(patientToken))
    .set("Content-Type", "application/octet-stream")
    .set("X-Medchain-Filename", encodeURIComponent("../../secret-xray.png"))
    .set("X-Medchain-Category", "xray")
    .set("X-Medchain-Description", encodeURIComponent(note))
    .send(png);
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.filename, "secret-xray.png");
  assert.equal(uploaded.body.storageKey, undefined);
  assert.equal(JSON.stringify(uploaded.body).includes(note), true);

  const listed = await request(app).get("/patient-portal/files").set(auth(patientToken));
  assert.equal(listed.status, 200);
  assert.equal(listed.body.files.length, 1);
  assert.equal(listed.body.files[0].uploaderLabel, "PATIENT-000010");

  const preview = await request(app)
    .get(`/patient-portal/files/${uploaded.body.id}/content?intent=preview`)
    .set(auth(patientToken))
    .buffer(true)
    .parse((result, callback) => {
      const chunks = [];
      result.on("data", (chunk) => chunks.push(chunk));
      result.on("end", () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers["content-type"], "image/png");
  assert.equal(preview.headers["content-disposition"].startsWith("inline;"), true);
  assert.equal(preview.headers["cache-control"], "private, no-store");
  assert.equal(Buffer.isBuffer(preview.body) && preview.body.equals(png), true);

  const download = await request(app)
    .get(`/patient-portal/files/${uploaded.body.id}/content?intent=download`)
    .set(auth(patientToken));
  assert.equal(download.status, 200);
  assert.equal(String(download.headers["content-disposition"]).startsWith("attachment;"), true);

  const otherList = await request(app).get("/patient-portal/files").set(auth(otherToken));
  assert.equal(otherList.body.files.length, 0);
  const otherFile = await request(app).get(`/patient-portal/files/${uploaded.body.id}/content`).set(auth(otherToken));
  assert.equal(otherFile.status, 404);

  const denied = await request(app).get("/patients/PATIENT-000010/files").set(auth(doctorToken));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "Patient consent is required.");
  assert.equal(JSON.stringify(denied.body).includes(marker), false);

  consent = true;
  const doctorUpload = await request(app)
    .post("/patients/PATIENT-000010/files")
    .set(auth(doctorToken))
    .set("Content-Type", "application/octet-stream")
    .set("X-Medchain-Filename", encodeURIComponent("blood.pdf"))
    .set("X-Medchain-Category", "blood_test")
    .send(Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("lab")]))
  ;
  assert.equal(doctorUpload.status, 201);
  assert.equal(doctorUpload.body.uploaderLabel, "Dr Sharma");
  const doctorDownload = await request(app)
    .get(`/patients/PATIENT-000010/files/${doctorUpload.body.id}/content?intent=preview`)
    .set(auth(doctorToken));
  assert.equal(doctorDownload.status, 200);

  const adminRead = await request(app).get("/patients/PATIENT-000010/files").set(auth(adminToken));
  assert.equal(adminRead.status, 403);
  assert.equal(JSON.stringify(adminRead.body).includes(marker), false);

  const invalid = await request(app)
    .post("/patient-portal/files")
    .set(auth(patientToken))
    .set("Content-Type", "application/octet-stream")
    .set("X-Medchain-Filename", encodeURIComponent("notes.pdf"))
    .set("X-Medchain-Category", "other")
    .send(Buffer.from("this is not a pdf"));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "This file type is not accepted. Use a PDF, JPG, or PNG.");

  const oversized = await request(app)
    .post("/patient-portal/files")
    .set(auth(patientToken))
    .set("Content-Type", "application/octet-stream")
    .set("X-Medchain-Filename", encodeURIComponent("large.png"))
    .set("X-Medchain-Category", "xray")
    .send(Buffer.concat([png, Buffer.alloc(64)]));
  assert.equal(oversized.status, 400);
  assert.equal(oversized.body.error, "This file is larger than 10 MB.");

  const names = audits.map((event) => event.action);
  assert.equal(names.includes("FILE_UPLOADED"), true);
  assert.equal(names.includes("FILE_VIEWED"), true);
  assert.equal(names.includes("FILE_DOWNLOADED"), true);
  assert.equal(names.includes("FILE_ACCESS_DENIED"), true);
  const uploadedAudit = audits.find((event) => event.action === "FILE_UPLOADED" && event.actorRole === "patient");
  assert.equal(uploadedAudit.actorId, null);
  assert.equal(uploadedAudit.publicPatientId, "PATIENT-000010");
  assert.equal(uploadedAudit.outcome, "success");
  const deniedAudit = audits.find((event) => event.action === "FILE_ACCESS_DENIED");
  assert.equal(deniedAudit.actorId, doctorId);
  assert.equal(deniedAudit.outcome, "denied");
  const auditText = JSON.stringify(audits);
  assert.equal(auditText.includes(note), false);
  assert.equal(auditText.includes(marker), false);
  for (const body of store.objects.values()) assert.equal(body.includes(Buffer.from(marker)), false);
  for (const body of store.objects.values()) assert.equal(body.includes(Buffer.from(note)), false);
});
