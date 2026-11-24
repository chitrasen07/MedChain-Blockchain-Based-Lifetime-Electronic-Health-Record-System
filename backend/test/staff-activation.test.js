const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { Wallet } = require("ethers");
const { createApp } = require("../src/app");
const { issueToken } = require("../src/auth");
const { hashActivationCode } = require("../src/staffActivation");

const secret = "test-secret-that-is-long-enough";
const identity = "identity-key";
const admin = { id: "admin", role: "administrator", hospital_id: "hospital-a", status: "active", token_version: 0 };
const otherAdmin = { id: "admin-b", role: "administrator", hospital_id: "hospital-b", status: "active", token_version: 0 };
const patientWallet = "0x1000000000000000000000000000000000000001";
const adminWallet = "0xD272a1e1027CDCDeA3ebbB8A9D01977e2030547F";

function sameHash(left, right) {
  return left.length > 0 && left === right;
}

function memory(chainRoles = {}) {
  const users = new Map();
  const codes = [];
  const challenges = new Map();
  const authorizations = [];
  const events = [];
  let sequence = 0;
  const db = {
    events,
    authorizations,
    codes,
    users,
    async getUserForAuth(id) {
      const user = [admin, otherAdmin].find((item) => item.id === id) || users.get(id);
      return user && user.status === "active" ? user : null;
    },
    async authenticateUser(email, password) {
      const user = [...users.values()].find((item) => item.email === String(email).toLowerCase());
      return user && user.status === "active" && user.password === password ? user : null;
    },
    async findUserByEmail(email) {
      const user = [...users.values()].find((item) => item.email === String(email).toLowerCase());
      return user ? { id: user.id, role: user.role, hospital_id: user.hospital_id, status: user.status, fullName: user.fullName } : null;
    },
    async recordActivity(event) { events.push(event); },
    async createDeferredStaff(input) {
      if ([...users.values()].some((item) => item.email === input.email.toLowerCase())) {
        throw Object.assign(new Error("duplicate"), { code: "23505", constraint: "users_email_key" });
      }
      const id = `staff-${++sequence}`;
      const user = {
        id,
        email: input.email.toLowerCase(),
        role: input.role,
        hospital_id: input.hospitalId,
        status: "pending",
        fullName: input.fullName,
        password: ""
      };
      users.set(id, user);
      codes.push({
        id: `code-${sequence}`,
        userId: id,
        hospitalId: input.hospitalId,
        codeHash: input.codeHash,
        chainRole: input.chainRole,
        expiresAt: input.expiresAt,
        usedAt: null,
        failed: 0
      });
      return { id, email: user.email, role: user.role, status: user.status, fullName: user.fullName };
    },
    async readStaffActivation(email, codeHash) {
      const user = [...users.values()].find((item) => item.email === String(email).toLowerCase());
      if (!user || user.role === "administrator") return { outcome: "invalid" };
      const context = { userId: user.id, hospitalId: user.hospital_id, role: user.role };
      const open = codes.find((item) => item.userId === user.id && !item.usedAt && item.hospitalId === user.hospital_id);
      if (!open) {
        const match = [...codes].reverse().find((item) => item.userId === user.id && sameHash(item.codeHash, codeHash));
        if (!match) return { outcome: "invalid" };
        if (match.failed >= 5) return { outcome: "locked", ...context };
        if (match.usedAt) return { outcome: "used", ...context };
        return { outcome: "expired", ...context };
      }
      if (!sameHash(open.codeHash, codeHash)) {
        open.failed += 1;
        if (open.failed >= 5) open.usedAt = new Date().toISOString();
        return { outcome: open.failed >= 5 ? "locked" : "invalid", ...context };
      }
      if (user.status !== "pending") return { outcome: "used", ...context };
      if (new Date(open.expiresAt).getTime() <= Date.now()) return { outcome: "expired", ...context };
      return {
        outcome: "ready",
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          hospitalId: user.hospital_id,
          chainRole: open.chainRole || ""
        }
      };
    },
    async completeStaffActivation({ userId, hospitalId, codeHash, password, walletAddress }) {
      const user = users.get(userId);
      const open = codes.find((item) => item.userId === userId && !item.usedAt && item.hospitalId === hospitalId);
      if (!user || user.hospital_id !== hospitalId || user.status !== "pending" || !open || !sameHash(open.codeHash, codeHash)) {
        const match = [...codes].reverse().find((item) => item.userId === userId && sameHash(item.codeHash, codeHash));
        return { outcome: match?.usedAt ? "used" : "invalid" };
      }
      if (new Date(open.expiresAt).getTime() <= Date.now()) return { outcome: "expired" };
      user.password = password;
      user.status = "active";
      let authorization = null;
      if (walletAddress) {
        if (authorizations.some((item) => item.walletAddress === walletAddress)) {
          throw Object.assign(new Error("duplicate wallet"), { code: "23505", constraint: "staff_chain_authorizations_wallet_key" });
        }
        authorization = { status: "pending", action: "grant", walletAddress, chainRole: open.chainRole };
        authorizations.push(authorization);
      }
      open.usedAt = new Date().toISOString();
      return { outcome: "activated", user, authorization };
    },
    async reissueStaffActivation({ userId, hospitalId, codeHash, expiresAt }) {
      const user = users.get(userId);
      if (!user || user.hospital_id !== hospitalId || user.role === "administrator") return null;
      if (user.status !== "pending") throw Object.assign(new Error("This account is already activated."), { statusCode: 409 });
      const previous = [...codes].reverse().find((item) => item.userId === userId);
      for (const item of codes) if (item.userId === userId && !item.usedAt) item.usedAt = new Date().toISOString();
      codes.push({ id: `code-${++sequence}`, userId, hospitalId, codeHash, chainRole: previous?.chainRole || null, expiresAt, usedAt: null, failed: 0 });
      return { role: user.role };
    },
    async walletUsedByPatient(wallet) { return String(wallet).toLowerCase() === patientWallet; },
    async walletUsedByStaff(wallet) { return authorizations.some((item) => item.walletAddress.toLowerCase() === String(wallet).toLowerCase()); },
    async createStaffWalletChallenge(input) { challenges.set(input.nonce, { ...input, used: false }); },
    async consumeStaffWalletChallenge(nonce) {
      const row = challenges.get(nonce);
      if (!row || row.used) return null;
      row.used = true;
      return { walletAddress: row.walletAddress, message: row.message };
    }
  };
  const blockchain = {
    async hospitalSigner() { return adminWallet; },
    async hasChainRole(role, account) { return chainRoles[`${role}:${String(account).toLowerCase()}`] === true; }
  };
  return {
    app: createApp({ db, blockchain, config: { corsOrigin: false, jwtSecret: secret, identityCommitmentKey: identity } }),
    db
  };
}

async function createDoctor(app, token, email = "doctor@example.test") {
  return request(app).post("/admin/users").set("Authorization", `Bearer ${token}`).send({
    fullName: "Clinical Doctor",
    email,
    role: "doctor",
    linkWallet: "later"
  });
}

test("activation codes are high entropy and only their hash is comparable", () => {
  const { createActivationCode } = require("../src/staffActivation");
  const code = createActivationCode();
  assert.match(code, /^[a-f0-9]{4}(?:-[a-f0-9]{4}){7}$/);
  const hash = hashActivationCode(code, identity);
  assert.equal(hash.length, 64);
  assert.equal(hash.includes(code.replaceAll("-", "")), false);
  assert.equal(hashActivationCode(`  ${code.toUpperCase()} `, identity), hash);
  assert.equal(hashActivationCode("short", identity), "");
});

test("a doctor activates from another session and cannot receive clinical access early", async () => {
  const { app, db } = memory();
  const token = issueToken(admin, secret);
  const created = await createDoctor(app, token);
  assert.equal(created.status, 201);
  assert.equal(created.body.status, "pending");
  assert.equal(typeof created.body.activationCode, "string");
  assert.equal(JSON.stringify(db.events).includes(created.body.activationCode.replaceAll("-", "")), false);
  assert.equal(db.codes[0].codeHash, hashActivationCode(created.body.activationCode, identity));
  const duplicate = await createDoctor(app, token);
  assert.equal(duplicate.status, 409);

  const blocked = await request(app).post("/auth/token").send({ email: "doctor@example.test", password: "synthetic-password" });
  assert.equal(blocked.status, 401);

  const missingWallet = await request(app).post("/auth/staff-activation").send({
    email: "doctor@example.test",
    activationCode: created.body.activationCode,
    password: "synthetic-password"
  });
  assert.equal(missingWallet.status, 400);
  assert.equal(missingWallet.body.error, "Connect the staff wallet before activating this account.");

  const wallet = Wallet.createRandom();
  const adminChallenge = await request(app).post("/auth/staff-activation/wallet-challenge").send({
    email: "doctor@example.test",
    activationCode: created.body.activationCode,
    walletAddress: adminWallet
  });
  assert.equal(adminChallenge.status, 400);
  assert.equal(adminChallenge.body.error, "The hospital administrator wallet cannot be the staff wallet.");
  const patientChallenge = await request(app).post("/auth/staff-activation/wallet-challenge").send({
    email: "doctor@example.test",
    activationCode: created.body.activationCode,
    walletAddress: patientWallet
  });
  assert.equal(patientChallenge.status, 400);
  const challenge = await request(app).post("/auth/staff-activation/wallet-challenge").send({
    email: "doctor@example.test",
    activationCode: created.body.activationCode,
    walletAddress: wallet.address
  });
  assert.equal(challenge.status, 200);
  assert.equal(challenge.body.chainRole, "DOCTOR");
  const signature = await wallet.signMessage(challenge.body.message);
  const activated = await request(app).post("/auth/staff-activation").send({
    email: "doctor@example.test",
    activationCode: created.body.activationCode,
    password: "synthetic-password",
    walletProof: { nonce: challenge.body.nonce, signature },
    role: "administrator"
  });
  assert.equal(activated.status, 200);
  assert.equal(activated.body.role, "doctor");
  assert.equal(activated.body.walletVerified, true);
  assert.equal(activated.body.authorization.status, "pending");
  assert.equal(db.authorizations[0].status, "pending");
  assert.equal(Object.hasOwn(activated.body, "token"), false);

  const replay = await request(app).post("/auth/staff-activation").send({
    email: "doctor@example.test",
    activationCode: created.body.activationCode,
    password: "synthetic-password"
  });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, "This activation code has already been used.");
  const signedIn = await request(app).post("/auth/token").send({ email: "doctor@example.test", password: "synthetic-password" });
  assert.equal(signedIn.status, 200);
  assert.equal(typeof signedIn.body.token, "string");
});

test("invalid, expired, and reused activation codes are rejected", async () => {
  const { app, db } = memory();
  const token = issueToken(admin, secret);
  const created = await createDoctor(app, token, "later@example.test");
  const wrong = await request(app).post("/auth/staff-activation").send({
    email: "later@example.test",
    activationCode: "aaaa-bbbb-cccc-dddd-eeee-ffff-0000-1111",
    password: "synthetic-password"
  });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "The activation code was not accepted.");
  db.codes[0].expiresAt = new Date(Date.now() - 1000).toISOString();
  const expired = await request(app).post("/auth/staff-activation").send({
    email: "later@example.test",
    activationCode: created.body.activationCode,
    password: "synthetic-password"
  });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error, "This activation code has expired. Ask the hospital administrator for a new code.");
  const replacement = await request(app).post(`/admin/users/${created.body.id}/activation-code`).set("Authorization", `Bearer ${token}`);
  assert.equal(replacement.status, 200);
  assert.notEqual(replacement.body.activationCode, created.body.activationCode);
  const stale = await request(app).post("/auth/staff-activation").send({
    email: "later@example.test",
    activationCode: created.body.activationCode,
    password: "synthetic-password"
  });
  assert.equal(stale.status, 400);
  const hidden = await request(app).post(`/admin/users/${created.body.id}/activation-code`).set("Authorization", `Bearer ${issueToken(otherAdmin, secret)}`);
  assert.equal(hidden.status, 404);
  const anonymous = await request(app).post(`/admin/users/${created.body.id}/activation-code`);
  assert.equal(anonymous.status, 401);
});

test("a receptionist activates without a wallet and an existing doctor can still sign in", async () => {
  const { app, db } = memory();
  db.users.set("existing", {
    id: "existing",
    email: "existing@example.test",
    role: "doctor",
    hospital_id: "hospital-a",
    status: "active",
    password: "synthetic-password",
    fullName: "Existing Doctor"
  });
  const token = issueToken(admin, secret);
  const created = await request(app).post("/admin/users").set("Authorization", `Bearer ${token}`).send({
    fullName: "Front Desk",
    email: "desk@example.test",
    role: "receptionist",
    linkWallet: "later"
  });
  assert.equal(created.status, 201);
  const activated = await request(app).post("/auth/staff-activation").send({
    email: "desk@example.test",
    activationCode: created.body.activationCode,
    password: "synthetic-password"
  });
  assert.equal(activated.status, 200);
  assert.equal(activated.body.walletVerified, false);
  assert.equal(activated.body.authorization, null);
  const existing = await request(app).post("/auth/token").send({ email: "existing@example.test", password: "synthetic-password" });
  assert.equal(existing.status, 200);
});

test("repeated wrong activation codes lock the invitation", async () => {
  const { app } = memory();
  const token = issueToken(admin, secret);
  const created = await createDoctor(app, token, "locked@example.test");
  let last = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    last = await request(app).post("/auth/staff-activation").send({
      email: "locked@example.test",
      activationCode: "bbbb-bbbb-bbbb-bbbb-bbbb-bbbb-bbbb-bbbb",
      password: "synthetic-password"
    });
  }
  assert.equal(last.status, 400);
  assert.equal(last.body.error, "Too many activation attempts. Ask the hospital administrator for a new code.");
  const real = await request(app).post("/auth/staff-activation").send({
    email: "locked@example.test",
    activationCode: created.body.activationCode,
    password: "synthetic-password"
  });
  assert.equal(real.status, 400);
});

test("a wallet that already holds another clinical role is rejected", async () => {
  const wallet = Wallet.createRandom();
  const { app } = memory({ [`NURSE:${wallet.address.toLowerCase()}`]: true });
  const token = issueToken(admin, secret);
  const created = await createDoctor(app, token, "conflict@example.test");
  const challenge = await request(app).post("/auth/staff-activation/wallet-challenge").send({
    email: "conflict@example.test",
    activationCode: created.body.activationCode,
    walletAddress: wallet.address
  });
  assert.equal(challenge.status, 400);
  assert.equal(challenge.body.error, "This wallet cannot be used for this staff role.");
});
