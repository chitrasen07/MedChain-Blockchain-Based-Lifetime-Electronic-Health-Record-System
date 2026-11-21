import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient, messageForRequest } from "../src/lib/api.js";
import { createAdminService, validateStaffAccount } from "../src/services/adminService.js";
import { createPatientService, describeMatch, describeRegistration, registrationReady, validateProfile } from "../src/services/patientService.js";
import { validateDecision } from "../src/services/reviewService.js";
import { createVisitService, validateVisit } from "../src/services/visitService.js";

function token() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 15 * 60;
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "user-1", role: "doctor", hospitalId: "hospital-1", exp })}.signature`;
}

function client(handler) {
  const api = createApiClient({
    baseUrl: "http://127.0.0.1:9",
    fetchImpl: async (url, options) => handler(url, options),
  });
  api.setAccessToken(token());
  return api;
}

describe("patient and visit requests", () => {
  it("omits blank optional profile fields and sends the bearer token", async () => {
    let seen;
    const patients = createPatientService(client(async (url, options) => {
      seen = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: "no_match", candidateCount: 0 }) };
    }));
    const parsed = validateProfile({
      fullName: "Synthetic Patient",
      dateOfBirth: "1990-01-01",
      mobile: "",
      email: "",
      emergencyContact: "  ",
      reviewCaseId: "",
    });
    assert.deepEqual(parsed.errors, {});
    assert.deepEqual(parsed.profile, { fullName: "Synthetic Patient", dateOfBirth: "1990-01-01" });
    const result = await patients.match(parsed.profile, "11111111-1111-4111-8111-111111111111");
    assert.equal(JSON.parse(seen.options.body).reviewCaseId, "11111111-1111-4111-8111-111111111111");
    assert.equal(registrationReady({ status: "review_authorized" }), true);
    assert.equal(registrationReady({ status: "review_required" }), false);
    assert.match(describeMatch({ status: "no_match" }), /No matching patient found/);
    assert.match(describeMatch({ status: "review_required" }), /Review is required/);
    assert.match(describeMatch({ status: "review_authorized" }), /Registration is allowed/);
    assert.match(describeMatch({ status: "review_same_person", patientId: "PATIENT-000001" }), /Same-person match/);
    assert.equal(result.status, "no_match");
    assert.equal(seen.url, "http://127.0.0.1:9/patients/match");
    assert.equal(seen.options.headers.Authorization.startsWith("Bearer "), true);
    assert.equal(seen.options.body.includes("emergencyContact"), false);
  });

  it("requires the backend hash format and describes an unfinished registration", () => {
    const invalid = validateVisit({ patientId: "PATIENT-000001", recordReference: "ref", recordHash: "abc" });
    assert.equal(Boolean(invalid.errors.recordHash), true);
    const valid = validateVisit({ patientId: "PATIENT-000001", recordReference: "ref", recordHash: `0x${"ab".repeat(32)}` });
    assert.deepEqual(valid.errors, {});
    assert.match(describeRegistration({ status: "registration_submitted", transaction: "0x1" }), /not complete/i);
    assert.match(describeRegistration(null, { resultStatus: "registration_failed" }), /not confirmed/i);
  });

  it("maps protected API failures without echoing server text", async () => {
    const visits = createVisitService(client(async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: "Insufficient permissions" }),
    })));
    await assert.rejects(visits.create("PATIENT-000001", { recordReference: "ref" }), (error) => {
      assert.equal(messageForRequest(error), "This account cannot perform that action.");
      assert.equal(String(error.message).includes("Insufficient"), false);
      return true;
    });
  });

  it("rejects administrator creation and same-person decisions without a candidate", () => {
    const staff = validateStaffAccount({ email: "doctor@hospital.test", password: "short", role: "administrator" });
    assert.equal(Boolean(staff.errors.password), true);
    assert.equal(Boolean(staff.errors.role), true);
    const decision = validateDecision({ decision: "same_patient", candidatePatientId: "other", notes: "" }, ["candidate-1"]);
    assert.equal(Boolean(decision.errors.candidatePatientId), true);
  });

  it("reports a timed-out request without treating it as a completed registration", async () => {
    const patients = createPatientService(client(async () => {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }));
    await assert.rejects(patients.match({ fullName: "Synthetic Patient", dateOfBirth: "1990-01-01" }), (error) => {
      assert.equal(error.code, "timeout");
      assert.match(messageForRequest(error), /does not confirm a registration/i);
      return true;
    });
  });

  it("shows a duplicate staff email and hides unexpected conflict text", async () => {
    const admin = createAdminService(client(async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: "A staff account with this email already exists." }),
    })));
    await assert.rejects(
      admin.createUser({ email: "doctor@example.test", password: "synthetic-password", role: "doctor" }),
      (error) => {
        assert.equal(messageForRequest(error), "A staff account with this email already exists.");
        return true;
      }
    );
    const review = createVisitService(client(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "Candidate is not part of this review." }),
    })));
    await assert.rejects(review.create("PATIENT-000001", { recordReference: "ref" }), (error) => {
      assert.equal(messageForRequest(error), "Candidate is not part of this review.");
      return true;
    });

    const visits = createVisitService(client(async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: "Key (email)=(secret@example.test) already exists." }),
    })));
    await assert.rejects(visits.create("PATIENT-000001", { recordReference: "ref" }), (error) => {
      assert.equal(messageForRequest(error), "That action conflicts with the current record.");
      assert.equal(String(error.message).includes("secret@example.test"), false);
      return true;
    });
  });

  it("disables an account with an authenticated POST and no body", async () => {
    let seen;
    const admin = createAdminService(client(async (url, options) => {
      seen = { url, options };
      return { ok: true, status: 204, text: async () => "" };
    }));
    const result = await admin.disableUser("staff-1");
    assert.equal(result, null);
    assert.equal(seen.options.method, "POST");
    assert.equal(seen.options.body, undefined);
    assert.equal(seen.url.endsWith("/admin/users/staff-1/disable"), true);
  });
});
