import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeForRole, pathAllowedForRole, readPatientSession, readSession } from "../src/lib/roles.js";
import { claimStatusBody } from "../src/services/patientPortal.js";

function token(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

const now = Date.parse("2026-11-20T00:00:00Z");
const patientRef = `0x${"ab".repeat(32)}`;
const walletAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

function patientPayload(overrides = {}) {
  return {
    sub: "patient-1",
    role: "patient",
    aud: "medchain-patient",
    hospitalId: "hospital-1",
    patientRef,
    walletAddress,
    exp: Math.floor(now / 1000) + 15 * 60,
    ...overrides,
  };
}

describe("patient session", () => {
  it("accepts a current patient token and rejects staff tokens", () => {
    const session = readPatientSession(token(patientPayload()), now);
    assert.equal(session.role, "patient");
    assert.equal(session.patientRef, patientRef);
    assert.equal(session.walletAddress, walletAddress);
    assert.equal(readSession(token(patientPayload()), now), null);
    assert.equal(readPatientSession(token(patientPayload({ role: "doctor", aud: undefined })), now), null);
    assert.equal(readPatientSession(token(patientPayload({ exp: Math.floor(now / 1000) - 1 })), now), null);
    assert.equal(homeForRole("patient"), "/patient");
    assert.equal(pathAllowedForRole("patient", "/patient/identity"), true);
    assert.equal(pathAllowedForRole("patient", "/patient/login"), false);
    assert.equal(pathAllowedForRole("patient", "/admin"), false);
    assert.equal(pathAllowedForRole("doctor", "/patient"), false);
  });

  it("builds a claim check without the recovery secret", () => {
    const body = claimStatusBody({
      patientId: "PATIENT-000001",
      walletAddress,
      claimCommitment: `0x${"12".repeat(32)}`,
    });
    assert.deepEqual(body, {
      patientId: "PATIENT-000001",
      walletAddress,
      claimCommitment: `0x${"12".repeat(32)}`,
    });
    assert.equal(Object.hasOwn(body, "recoveryCode"), false);
    assert.equal(Object.hasOwn(body, "secret"), false);
  });
});
