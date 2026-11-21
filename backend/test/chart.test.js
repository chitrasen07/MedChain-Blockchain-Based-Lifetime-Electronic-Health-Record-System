const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { issueToken, issuePatientToken } = require("../src/auth");
const { encryptJson } = require("../src/crypto");
const { allergyAlerts, ageYears, anchorStatus, buildPatientChart, emergencyCard, numericPoint } = require("../src/chart");
const { linesFor, renderSummaryPdf } = require("../src/summaryPdf");

const secret = "test-secret-that-is-long-enough";
const piiKey = "33".repeat(32);
const patientRef = `0x${"cd".repeat(32)}`;
const doctor = { id: "doctor-1", role: "doctor", hospital_id: "hospital-a", status: "active" };
const other = { id: "doctor-2", role: "doctor", hospital_id: "hospital-b", status: "active" };

function token(user) {
  return issueToken(user, secret);
}

test("summary uses stored facts and leaves missing fields unrecorded", () => {
  assert.equal(ageYears("2000-11-21", "2026-11-20"), 25);
  assert.equal(ageYears("2000-11-21", "2026-11-21"), 26);
  const chart = buildPatientChart({
    profile: { fullName: "Asha Verma", dateOfBirth: "2000-11-21" },
    profileNotes: [{ bloodGroup: "O+", createdAt: "2026-01-01" }],
    patientId: "PATIENT-000002",
    patientRef,
    today: "2026-11-21",
    access: "consent",
    records: [
      record("allergy", 0, { substance: "Penicillin", reaction: "Rash" }, "2024-01-01"),
      record("diagnosis", 0, { condition: "Asthma", status: "current", chronic: "yes" }, "2024-02-01"),
      record("diagnosis", 1, { condition: "Asthma controlled", status: "current", chronic: "yes" }, "2025-02-01", { prior: true }),
      record("diagnosis", 0, { condition: "Fracture", status: "past" }, "2023-01-01", { ref: "diag-2" }),
      record("prescription", 0, { medication: "Salbutamol", dose: "2 puffs", frequency: "as needed" }, "2025-02-01", { ref: "rx-1" }),
      record("prescription", 0, { medication: "Amoxicillin", dose: "500 mg", endDate: "2024-01-08" }, "2024-01-01", { ref: "rx-2" }),
      record("treatment", 0, { treatment: "Appendicectomy", kind: "surgery" }, "2019-05-01", { ref: "tx-1" }),
      record("visit", 0, { reason: "Review" }, "2026-10-01", { ref: "visit-1" }),
      record("vital", 0, { heartRate: "72", heartRateUnit: "bpm" }, "2026-10-01", { ref: "vital-1" }),
      record("laboratory", 0, { testName: "Hemoglobin", result: "13.2", unit: "g/dL" }, "2026-09-01", { ref: "lab-1" }),
      record("laboratory", 0, { testName: "Hemoglobin", result: "13.8", unit: "g/dL", referenceRange: "12-16" }, "2026-10-01", { ref: "lab-2" })
    ],
    visits: [{ id: "visit-ref", createdAt: "2026-08-01T00:00:00.000Z" }],
    permissions: [{ wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", active: true, status: "active", expiresAt: null }],
    consentHistory: [{ action: "granted", wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", transaction: `0x${"ab".repeat(32)}` }],
    doctors: [{ name: "Dr Meera", walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }],
    audit: [{ action: "record_created", actor: "Dr Meera", at: "2026-10-01", source: "hospital" }]
  });
  assert.equal(chart.summary.fullName, "Asha Verma");
  assert.equal(chart.summary.age, 26);
  assert.equal(chart.summary.gender, "Not recorded");
  assert.equal(chart.summary.bloodGroup, "O+");
  assert.deepEqual(chart.summary.currentDiseases, ["Asthma controlled"]);
  assert.deepEqual(chart.summary.pastDiseases, ["Fracture"]);
  assert.equal(chart.summary.latestDiagnosis, "Asthma controlled");
  assert.deepEqual(chart.summary.currentMedications, ["Salbutamol"]);
  assert.deepEqual(chart.summary.surgeries, ["Appendicectomy"]);
  assert.equal(chart.summary.lastVisit, "2026-10-01");
  assert.equal(chart.versions.find((item) => item.category === "diagnosis").versions.length, 2);
  assert.equal(chart.timeline.some((item) => item.correction), true);
  assert.equal(chart.vitals[0].points[0].value, "72");
  assert.equal(chart.vitals[0].points[0].unit, "bpm");
  assert.equal(chart.labs.trends.length, 1);
  assert.equal("interpretation" in chart.labs.results[0], false);
  assert.equal(chart.consent[0].doctorName, "Dr Meera");
  assert.equal(chart.consent[0].events[0].etherscanUrl.startsWith("https://sepolia.etherscan.io/tx/"), true);
  assert.equal(chart.blockchain[0].storage, "Encrypted");
  assert.equal(anchorStatus({ chainStatus: "anchored", transaction: `0x${"aa".repeat(32)}` }), "Anchored");
  assert.equal(anchorStatus({ chainStatus: "consent_required", transaction: `0x${"aa".repeat(32)}` }), "Pending");
  assert.equal(anchorStatus({ chainStatus: "failed", transaction: `0x${"aa".repeat(32)}` }), "Failed");
  assert.equal(anchorStatus({ chainStatus: "consent_required" }), "Not anchored");
});

test("allergy alerts require an exact recorded match and do not invent interactions", () => {
  const allergies = [{ substance: "Penicillin", reaction: "Rash" }];
  assert.equal(allergyAlerts(allergies, "penicillin").length, 1);
  assert.equal(allergyAlerts(allergies, "Amoxicillin").length, 0);
  assert.equal(numericPoint("120/80").systolic, 120);
  assert.equal(numericPoint("high"), null);
});

test("emergency access does not reveal consent-only categories", () => {
  const chart = buildPatientChart({
    profile: { fullName: "Asha Verma" },
    patientId: "PATIENT-000002",
    patientRef,
    today: "2026-11-21",
    access: "emergency",
    records: [
      record("allergy", 0, { substance: "Penicillin" }, "2024-01-01"),
      record("treatment", 0, { treatment: "Private surgery", kind: "surgery" }, "2019-05-01", { ref: "tx" }),
      record("vital", 0, { weight: "70", weightUnit: "kg" }, "2026-01-01", { ref: "vital" })
    ],
    audit: [
      { action: "record_viewed", actor: "doctor", source: "hospital" },
      { action: "EMERGENCY_ACCESS_GRANTED", actor: "0xabc", source: "chain" }
    ]
  });
  assert.deepEqual(chart.summary.allergies, ["Penicillin"]);
  assert.deepEqual(chart.summary.surgeries, []);
  assert.deepEqual(chart.vitals, []);
  assert.equal(chart.audit.length, 1);
  assert.equal(chart.audit[0].action, "Emergency access used");
});

test("the emergency card and PDF contain no secrets or clinical invention", () => {
  const card = emergencyCard("PATIENT-000002");
  assert.equal(card.lookupPath, "/doctor/lookup?patientId=PATIENT-000002");
  assert.equal(JSON.stringify(card).includes("Penicillin"), false);
  assert.equal(JSON.stringify(card).includes("token"), false);
  const chart = buildPatientChart({
    profile: { fullName: "Asha Verma" },
    patientId: "PATIENT-000002",
    patientRef,
    today: "2026-11-21",
    access: "patient",
    records: []
  });
  const pdf = renderSummaryPdf(chart);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const lines = linesFor(chart).join("\n");
  assert.equal(lines.includes("Asha Verma"), true);
  assert.equal(lines.includes("Not recorded"), true);
  assert.equal(lines.includes("Bearer"), false);
});

test("a doctor without consent cannot read another patient's chart", async () => {
  const wallet = Wallet.createRandom();
  const { app, chain } = chartApp({ consent: false });
  await bind(app, wallet, chain);
  const denied = await request(app).get("/patients/PATIENT-000002/chart").set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(denied.status, 403);
  const wrongHospital = await request(app).get("/patients/PATIENT-000002/chart").set("Authorization", `Bearer ${token(other)}`);
  assert.equal(wrongHospital.status, 404);
  const patientToken = issuePatientToken(
    { id: "row-1", hospital_id: "hospital-a", did: patientRef },
    wallet.address,
    secret
  );
  const cross = await request(app).get("/patients/PATIENT-000009/chart").set("Authorization", `Bearer ${patientToken}`);
  assert.equal(cross.status, 401);
});

test("consented chart reads stored data and does not invent missing entries", async () => {
  const wallet = Wallet.createRandom();
  const { app, chain } = chartApp({ consent: true });
  await bind(app, wallet, chain);
  const created = await request(app)
    .post("/patients/PATIENT-000002/records")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ category: "vital", recordedOn: "2026-11-01", fields: { heartRate: "80", heartRateUnit: "bpm" } });
  assert.equal(created.status, 201);
  const chart = await request(app).get("/patients/PATIENT-000002/chart").set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(chart.status, 200);
  assert.equal(chart.body.summary.fullName, "Asha Verma");
  assert.equal(chart.body.vitals[0].points[0].value, "80");
  assert.equal(chart.body.summary.gender, "Not recorded");
  const pdf = await request(app).get("/patients/PATIENT-000002/chart.pdf").set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(pdf.status, 200);
  assert.match(String(pdf.headers["content-type"]), /^application\/pdf/);
  const bytes = Buffer.isBuffer(pdf.body) ? pdf.body : Buffer.from(pdf.text || "");
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const card = await request(app).get("/patients/PATIENT-000002/emergency-card").set("Authorization", `Bearer ${token(doctor)}`);
  assert.equal(card.body.containsClinicalData, false);
  const portal = await request(app)
    .get("/patient-portal/chart")
    .set("Authorization", `Bearer ${issuePatientToken({ id: "row-1", hospital_id: "hospital-a", did: patientRef }, wallet.address, secret)}`);
  assert.equal(portal.status, 200);
  assert.equal(portal.body.patientId, "PATIENT-000002");
});

function record(category, versionIndex, content, recordedOn, extra = {}) {
  return {
    id: `${category}-${extra.ref || "one"}-${versionIndex}`,
    category,
    versionIndex,
    recordRef: extra.ref || `${category}-one`,
    contentHash: `0x${"11".repeat(32)}`,
    chainStatus: extra.anchored ? "anchored" : "consent_required",
    transaction: extra.anchored ? `0x${"22".repeat(32)}` : null,
    recordedOn,
    createdAt: `${recordedOn}T00:00:00.000Z`,
    authorName: "Dr Meera",
    content: { category, recordedOn, ...content }
  };
}

function chartApp({ consent }) {
  const sessions = new Map();
  const challenges = new Map();
  const rows = [];
  const ciphertext = encryptJson({ fullName: "Asha Verma", dateOfBirth: "2000-11-21" }, Buffer.from(piiKey, "hex"));
  const patient = {
    id: "row-1",
    patientId: "PATIENT-000002",
    did: patientRef,
    hospital_id: "hospital-a",
    status: "confirmed",
    piiCiphertext: ciphertext
  };
  const chain = {
    hospital: Wallet.createRandom().address,
    medical: new Set()
  };
  const db = {
    async getUserForAuth(id) {
      return id === doctor.id ? doctor : id === other.id ? other : null;
    },
    async getPatient(patientId, hospitalId) {
      return patientId === patient.patientId && hospitalId === patient.hospital_id
        ? { patientId, did: patientRef, status: "confirmed" }
        : null;
    },
    async getPatientForAuth(id) {
      return id === patient.id ? patient : null;
    },
    async getPatientChartSource(patientId, hospitalId) {
      return patientId === patient.patientId && hospitalId === patient.hospital_id ? patient : null;
    },
    async listMedicalRecordsByPublicId() { return rows; },
    async listMedicalRecordsForPatient() { return rows; },
    async listPatientVisits() { return []; },
    async listProfileNotes() { return []; },
    async listClinicalAudit() { return []; },
    async listAccessAuditForHospital() { return []; },
    async listConsentDoctors() { return []; },
    async createClinicalAudit() {},
    async createMedicalRecord(input) {
      const row = {
        id: "11111111-1111-4111-8111-000000000001",
        ...input,
        chainStatus: "consent_required",
        txHash: null,
        publicPatientId: input.publicPatientId,
        hospitalId: input.hospitalId
      };
      rows.push(row);
      return row;
    },
    async createClinicalChallenge(input) { challenges.set(input.nonce, { ...input, used: false }); },
    async consumeClinicalChallenge(nonce) {
      const challenge = challenges.get(nonce);
      if (!challenge || challenge.used) return null;
      challenge.used = true;
      return challenge;
    },
    async saveClinicalWallet(input) { sessions.set(input.userId, input.walletAddress); },
    async getClinicalWallet(userId) { return sessions.get(userId) || null; }
  };
  const blockchain = {
    async hospitalSigner() { return chain.hospital; },
    async isMedicalStaff(account) { return chain.medical.has(account.toLowerCase()); },
    async hasAccess() { return consent; },
    async checkEmergencyAccess() { return false; },
    async listConsent() { return []; },
    async listConsentHistory() { return []; },
    async listEmergency() { return []; },
    async listAudit() { return []; }
  };
  return {
    app: createApp({ db, blockchain, config: { corsOrigin: false, jwtSecret: secret, piiEncryptionKey: piiKey } }),
    chain
  };
}

async function bind(app, wallet, chain) {
  chain.medical.add(wallet.address.toLowerCase());
  const challenge = await request(app)
    .post("/clinical-wallet/challenge")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ walletAddress: wallet.address });
  assert.equal(challenge.status, 200);
  const signature = await wallet.signMessage(challenge.body.message);
  const session = await request(app)
    .post("/clinical-wallet/session")
    .set("Authorization", `Bearer ${token(doctor)}`)
    .send({ walletAddress: wallet.address, nonce: challenge.body.nonce, signature });
  assert.equal(session.status, 200);
}
