import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, createApiClient, messageForRequest } from "../src/lib/api.js";
import { passwordProblems, passwordStrength } from "../src/lib/passwordChange.js";

function token() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = { sub: "user-1", role: "doctor", hospitalId: "h1", exp: Math.floor(Date.now() / 1000) + 600 };
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("password change rules", () => {
  it("requires a strong new password and a matching confirmation", () => {
    const weak = passwordProblems({ currentPassword: "Current-password-1", newPassword: "short", confirmPassword: "short" });
    assert.match(weak.newPassword, /12 characters/);
    const mismatch = passwordProblems({ currentPassword: "Current-password-1", newPassword: "Replacement-password-2", confirmPassword: "Other-password-2" });
    assert.match(mismatch.confirmPassword, /does not match/);
    const reused = passwordProblems({ currentPassword: "Current-password-1", newPassword: "Current-password-1", confirmPassword: "Current-password-1" });
    assert.match(reused.newPassword, /different from the current password/);
    const ready = passwordProblems({ currentPassword: "Current-password-1", newPassword: "Replacement-password-2", confirmPassword: "Replacement-password-2" });
    assert.deepEqual(ready, { currentPassword: "", newPassword: "", confirmPassword: "" });
    assert.equal(passwordStrength("short").label, "Weak");
    assert.equal(passwordStrength("Replacement-password-2").label, "Strong");
  });

  it("sends only the current and new passwords and keeps the API message", async () => {
    let seen;
    const api = createApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async (url, options) => {
        seen = { url, options };
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: "password_updated" }) };
      },
    });
    api.setAccessToken(token());
    const result = await api.changePassword({ currentPassword: "Current-password-1", newPassword: "Replacement-password-2" });
    assert.deepEqual(result, { status: "password_updated" });
    assert.equal(seen.url, "http://127.0.0.1:9/auth/password");
    assert.deepEqual(JSON.parse(seen.options.body), { currentPassword: "Current-password-1", newPassword: "Replacement-password-2" });
    assert.match(seen.options.headers.Authorization, /^Bearer /);

    const rejected = createApiClient({
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: "The current password was not accepted." }) }),
    });
    rejected.setAccessToken(token());
    await assert.rejects(
      rejected.changePassword({ currentPassword: "wrong", newPassword: "Replacement-password-2" }),
      (error) => {
        assert.equal(error instanceof ApiError, true);
        assert.equal(messageForRequest(error), "The current password was not accepted.");
        return true;
      },
    );
  });
});
