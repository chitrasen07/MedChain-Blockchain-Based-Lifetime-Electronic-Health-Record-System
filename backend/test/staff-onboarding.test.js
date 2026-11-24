const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");

const secret = "test-secret-that-is-long-enough";
const admin = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active" };

function appFor() {
  const calls = [];
  const challenges = new Map();
  const users = new Map();
  const db = {
    async getUserForAuth(id) { return id === admin.id ? admin : null; },
    async createStaffWalletChallenge(input) { challenges.set(input.nonce, { ...input, used: false }); },
    async consumeStaffWalletChallenge(nonce) {
      const row = challenges.get(nonce);
      if (!row || row.used) return null;
      row.used = true;
      return { walletAddress: row.walletAddress, message: row.message };
    },
    async createUser(input) {
      calls.push("createUser");
      const id = "staff-1";
      users.set(id, {
        id,
        email: input.email,
        fullName: input.fullName,
        role: input.role,
        status: "active",
        walletAddress: input.authorization?.walletAddress || null,
        chainRole: input.authorization?.chainRole || null,
        authorizationStatus: input.authorization ? "pending" : null,
        authorizationAction: input.authorization ? "grant" : null
      });
      return { id, email: input.email, role: input.role, status: "active", fullName: input.fullName, authorization: input.authorization ? { status: "pending", action: "grant", walletAddress: input.authorization.walletAddress, chainRole: input.authorization.chainRole } : null };
    },
    async getStaffMember(id) { return users.get(id) || null; },
    async saveStaffAuthorization(input) {
      calls.push("saveStaffAuthorization");
      const current = users.get(input.userId);
      users.set(input.userId, { ...current, walletAddress: input.walletAddress, chainRole: input.chainRole, authorizationStatus: "pending", authorizationAction: input.action });
    },
    async markStaffAuthorization(id, hospitalId, status) {
      calls.push(`mark:${status}`);
      const current = users.get(id);
      users.set(id, { ...current, authorizationStatus: status });
    }
  };
  const blockchain = {
    async hospitalSigner() { return "0xD272a1e1027CDCDeA3ebbB8A9D01977e2030547F"; },
    async hasChainRole(roleName, account) {
      calls.push(`has:${roleName}`);
      return roleName === "DOCTOR" && String(account).toLowerCase() === "0xf7d8e63eb6d81c4faded4fdda7edb10d28b54bb0";
    }
  };
  return {
    app: createApp({ db, blockchain, config: { corsOrigin: false, jwtSecret: secret } }),
    calls,
    users
  };
}

test("clinical onboarding requires one wallet signature and rejects chain-role escalation", async () => {
  const wallet = Wallet.createRandom();
  const { app, calls } = appFor();
  const token = issueToken(admin, secret);
  const unsigned = await request(app).post("/admin/users").set("Authorization", `Bearer ${token}`).send({
    fullName: "Clinical Doctor",
    email: "doctor@example.test",
    password: "synthetic-password",
    role: "doctor"
  });
  assert.equal(unsigned.status, 400);
  assert.equal(unsigned.body.error, "The staff wallet must sign before a clinical account is created.");
  assert.equal(calls.includes("createUser"), false);

  const escalated = await request(app).post("/admin/staff-wallet/challenge").set("Authorization", `Bearer ${token}`).send({
    fullName: "Clinical Doctor",
    email: "doctor@example.test",
    role: "doctor",
    chainRole: "SUPER_ADMIN",
    walletAddress: wallet.address
  });
  assert.equal(escalated.status, 400);
  assert.equal(escalated.body.error, "This role cannot be granted on the blockchain.");

  const challenge = await request(app).post("/admin/staff-wallet/challenge").set("Authorization", `Bearer ${token}`).send({
    fullName: "Clinical Doctor",
    email: "doctor@example.test",
    role: "doctor",
    walletAddress: wallet.address
  });
  assert.equal(challenge.status, 200);
  assert.equal(challenge.body.chainRole, "DOCTOR");
  const signature = await wallet.signMessage(challenge.body.message);
  const created = await request(app).post("/admin/users").set("Authorization", `Bearer ${token}`).send({
    fullName: "Clinical Doctor",
    email: "doctor@example.test",
    password: "synthetic-password",
    role: "doctor",
    walletProof: { nonce: challenge.body.nonce, signature }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.authorization.status, "pending");
  assert.equal(calls.filter((call) => call === "createUser").length, 1);

  const retry = await request(app).post("/admin/users/staff-1/authorization").set("Authorization", `Bearer ${token}`).send({ chainRole: "DOCTOR" });
  assert.equal(retry.status, 200);
  assert.equal(calls.filter((call) => call === "createUser").length, 1);
  assert.equal(calls.includes("saveStaffAuthorization"), true);
});

test("verify marks an already granted doctor role active without another transaction", async () => {
  const { app, calls, users } = appFor();
  users.set("staff-1", {
    id: "staff-1",
    role: "doctor",
    status: "active",
    walletAddress: "0xf7d8e63eb6d81c4faded4fdda7edb10d28b54bb0",
    chainRole: "DOCTOR",
    previousChainRole: null,
    authorizationStatus: "pending",
    authorizationAction: "grant"
  });
  const response = await request(app)
    .post("/admin/users/staff-1/authorization/verify")
    .set("Authorization", `Bearer ${issueToken(admin, secret)}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "active", verified: true });
  assert.equal(calls.includes("mark:active"), true);
  assert.equal(calls.includes("createUser"), false);
});

test("authorization verify rejects missing and non-admin sessions", async () => {
  const { app } = appFor();
  const missing = await request(app).post("/admin/users/staff-1/authorization/verify");
  assert.equal(missing.status, 401);
  const doctor = { id: "doc", role: "doctor", hospital_id: "hospital-a", status: "active", token_version: 0 };
  const denied = createApp({
    db: { async getUserForAuth(id) { return id === doctor.id ? doctor : null; } },
    blockchain: { async hasChainRole() { throw new Error("should not run"); } },
    config: { corsOrigin: false, jwtSecret: secret }
  });
  const response = await request(denied)
    .post("/admin/users/staff-1/authorization/verify")
    .set("Authorization", `Bearer ${issueToken(doctor, secret)}`);
  assert.equal(response.status, 403);
});

test("authorization verify returns 503 when Sepolia cannot be read and does not activate the role", async () => {
  const calls = [];
  const member = {
    id: "staff-1",
    role: "doctor",
    status: "active",
    walletAddress: "0xf7d8e63eb6d81c4faded4fdda7edb10d28b54bb0",
    chainRole: "DOCTOR",
    authorizationStatus: "pending",
    authorizationAction: "grant"
  };
  const app = createApp({
    db: {
      async getUserForAuth(id) { return id === admin.id ? admin : null; },
      async getStaffMember(id, hospitalId) {
        calls.push(`lookup:${hospitalId}:${id}`);
        return hospitalId === admin.hospital_id && id === member.id ? member : null;
      },
      async markStaffAuthorization() { calls.push("mark:active"); }
    },
    blockchain: {
      async hasChainRole() {
        const error = new Error("rpc down");
        error.code = "NETWORK_ERROR";
        throw error;
      }
    },
    config: { corsOrigin: false, jwtSecret: secret }
  });
  const unavailable = await request(app)
    .post("/admin/users/staff-1/authorization/verify")
    .set("Authorization", `Bearer ${issueToken(admin, secret)}`);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error, "Service unavailable");
  const hidden = await request(app)
    .post("/admin/users/other-hospital-staff/authorization/verify")
    .set("Authorization", `Bearer ${issueToken(admin, secret)}`);
  assert.equal(hidden.status, 404);
  assert.equal(calls.includes("mark:active"), false);
  assert.equal(calls.includes("lookup:hospital-a:staff-1"), true);
  assert.equal(calls.includes("lookup:hospital-a:other-hospital-staff"), true);
});
