import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiError, createApiClient, messageForAuthFailure } from "../src/lib/api.js";
import { homeForRole, pathAllowedForRole, readSession, STAFF_ROLES } from "../src/lib/roles.js";

function token(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

const now = Date.parse("2026-11-14T00:00:00Z");

function sessionPayload(overrides = {}) {
  return {
    sub: "user-1",
    role: "doctor",
    hospitalId: "hospital-1",
    exp: Math.floor(now / 1000) + 15 * 60,
    ...overrides,
  };
}

describe("staff session", () => {
  it("reads a current staff token", () => {
    const session = readSession(token(sessionPayload()), now);
    assert.deepEqual(session, {
      id: "user-1",
      role: "doctor",
      hospitalId: "hospital-1",
      expiresAt: (Math.floor(now / 1000) + 15 * 60) * 1000,
    });
  });

  it("rejects expired, overlong, unknown, and malformed tokens", () => {
    assert.equal(readSession(token(sessionPayload({ exp: Math.floor(now / 1000) - 1 })), now), null);
    assert.equal(readSession(token(sessionPayload({ exp: Math.floor(now / 1000) + 60 * 60 })), now), null);
    assert.equal(readSession(token(sessionPayload({ role: "patient" })), now), null);
    assert.equal(readSession(token(sessionPayload({ role: "emergency" })), now), null);
    assert.equal(readSession("not-a-token", now), null);
    assert.equal(readSession(token(sessionPayload({ hospitalId: "" })), now), null);
  });

  it("maps each staff role to its own workspace", () => {
    assert.deepEqual(
      STAFF_ROLES.map((role) => homeForRole(role)),
      ["/admin", "/doctor", "/receptionist", "/staff", "/reviewer"],
    );
    assert.equal(pathAllowedForRole("doctor", "/doctor/visits"), true);
    assert.equal(pathAllowedForRole("doctor", "/admin"), false);
    assert.equal(pathAllowedForRole("doctor", "/administration"), false);
    assert.equal(pathAllowedForRole("administrator", "/admin/staff"), true);
  });
});

describe("auth API client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function client(handler) {
    return createApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async (url, options) => handler(url, options),
    });
  }

  function liveToken(overrides = {}) {
    return token(sessionPayload({ exp: Math.floor(Date.now() / 1000) + 15 * 60, ...overrides }));
  }

  it("posts credentials and returns a usable token without keeping the response body", async () => {
    let seen;
    const api = client(async (url, options) => {
      seen = { url, options };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ token: liveToken() }),
      };
    });
    const issued = await api.login("doctor@hospital.org", "a-real-password");
    assert.equal(typeof issued, "string");
    assert.equal(seen.url, "http://127.0.0.1:9/auth/token");
    assert.equal(seen.options.method, "POST");
    assert.equal(seen.options.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(seen.options.body), {
      email: "doctor@hospital.org",
      password: "a-real-password",
    });
    assert.equal(seen.options.body.includes("token"), false);
  });

  it("maps 401, 403, 429, and network failures to safe messages", async () => {
    const unauthorized = client(async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: "Invalid credentials" }) }));
    await assert.rejects(unauthorized.login("a@hospital.org", "wrong-password"), (error) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal(error.status, 401);
      assert.equal(messageForAuthFailure(error), "The email or password was not accepted.");
      assert.equal(error.message.includes("Invalid credentials"), false);
      return true;
    });

    const limited = client(async () => ({ ok: false, status: 429, text: async () => "Too many requests" }));
    await assert.rejects(limited.login("a@hospital.org", "wrong-password"), (error) => {
      assert.equal(messageForAuthFailure(error), "Too many sign-in attempts. Wait and try again.");
      return true;
    });

    const invalid = client(async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: "Invalid request" }) }));
    await assert.rejects(invalid.login("a@hospital.org", "wrong-password"), (error) => {
      assert.equal(messageForAuthFailure(error), "Check the email and password and try again.");
      assert.equal(error.message.includes("Invalid request"), false);
      return true;
    });

    const forbidden = client(async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: "secret policy" }) }));
    await assert.rejects(forbidden.login("a@hospital.org", "wrong-password"), (error) => {
      assert.equal(messageForAuthFailure(error), "This account cannot sign in.");
      assert.equal(error.message.includes("secret"), false);
      return true;
    });

    const offline = client(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    await assert.rejects(offline.login("a@hospital.org", "wrong-password"), (error) => {
      assert.equal(error.code, "network");
      assert.equal(messageForAuthFailure(error), "The hospital service could not be reached.");
      return true;
    });
  });

  it("clears an authenticated client when a later request returns 401", async () => {
    let calls = 0;
    const api = client(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ token: liveToken() }) };
      }
      return { ok: false, status: 401, text: async () => JSON.stringify({ error: "Authentication required" }) };
    });
    let expired = false;
    api.setUnauthorizedHandler(() => {
      expired = true;
    });
    api.setAccessToken(await api.login("doctor@hospital.org", "a-real-password"));
    await assert.rejects(api.request("/patients/example"), (error) => error.status === 401);
    assert.equal(expired, true);
  });

  it("rejects a login response whose token is already expired", async () => {
    const api = client(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: token(sessionPayload({ exp: 1 })) }),
    }));
    await assert.rejects(api.login("a@hospital.org", "a-real-password"), (error) => error.code === "server");
  });
});
