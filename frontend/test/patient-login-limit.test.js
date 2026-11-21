import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { patientAuthMessage, patientRetryLabel } from "../src/services/patientPortal.js";

describe("patient sign-in limit", () => {
  it("shows the server wait time and does not describe the limit as disabled", () => {
    const message = patientAuthMessage({ status: 429, retryAfterSeconds: 90 });
    assert.equal(message, "Too many sign-in attempts for this patient. Wait 1 minute and try again.");
    assert.equal(patientRetryLabel(15), "15 seconds");
    assert.equal(patientRetryLabel(125), "3 minutes");
    assert.equal(message.includes("unlimited"), false);
  });
});
