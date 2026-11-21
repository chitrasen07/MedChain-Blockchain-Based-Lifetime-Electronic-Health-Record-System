const test = require("node:test");
const assert = require("node:assert/strict");
const { assessAnchor } = require("../src/consentChain");

const controller = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const doctor = "0xf7d8e63eb6d81c4faded4fdda7edb10d28b54bb0";
const now = 1_800_000_000;

function ready(overrides = {}) {
  return assessAnchor({
    chainId: 11155111,
    patientActive: true,
    controller,
    doctorRole: true,
    hasAccess: true,
    grantExists: true,
    expiresAt: 0,
    versionIndex: 0,
    onChainVersions: 0,
    chainStatus: "consent_required",
    wallet: doctor,
    connectedWallet: doctor,
    nowSeconds: now,
    ...overrides
  });
}

test("an existing patient with valid consent can be anchored", () => {
  assert.equal(ready().ok, true);
});

test("a newly registered wallet-linked patient with valid consent can be anchored", () => {
  assert.equal(ready({ controller: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", onChainVersions: 0 }).ok, true);
});

test("a patient without consent is refused before a transaction", () => {
  const result = ready({ hasAccess: false, grantExists: false });
  assert.equal(result.ok, false);
  assert.match(result.message, /does not have consent/);
});

test("expired and revoked consent are refused separately", () => {
  const expired = ready({ hasAccess: false, grantExists: true, expiresAt: now - 10 });
  const revoked = ready({ hasAccess: false, grantExists: true, expiresAt: 0 });
  assert.match(expired.message, /expired/);
  assert.match(revoked.message, /revoked/);
});

test("the wrong wallet, network, or missing doctor role is refused", () => {
  assert.match(ready({ connectedWallet: controller }).message, /consented clinical wallet/);
  assert.match(ready({ chainId: 1 }).message, /Sepolia/);
  assert.match(ready({ doctorRole: false }).message, /Doctor role/);
  assert.match(ready({ controller: "0x0000000000000000000000000000000000000000" }).message, /no wallet controller/);
});

test("a duplicate or out-of-order anchor is refused", () => {
  assert.match(ready({ chainStatus: "anchored" }).message, /already anchored/);
  assert.match(ready({ onChainVersions: 1, versionIndex: 0 }).message, /already anchored/);
  assert.match(ready({ pendingHash: `0x${"ab".repeat(32)}` }).message, /already pending/);
  assert.match(ready({ versionIndex: 1, onChainVersions: 0 }).message, /previous version/);
});
