import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anchorLabel, emergencyCardUrl, exactAllergyAlert, filterTimeline } from "../src/lib/chartView.js";

describe("patient chart view", () => {
  it("labels anchor states and keeps the emergency card free of clinical text", () => {
    assert.equal(anchorLabel({ chainStatus: "anchored", transaction: "0xabc" }), "Anchored");
    assert.equal(anchorLabel({ chainStatus: "failed", transaction: "0xabc" }), "Failed");
    assert.equal(anchorLabel({ chainStatus: "consent_required", transaction: "0xabc" }), "Pending");
    assert.equal(anchorLabel({ chainStatus: "consent_required" }), "Not anchored");
    const url = emergencyCardUrl("https://medchain-silk.vercel.app", "PATIENT-000002");
    assert.equal(url, "https://medchain-silk.vercel.app/doctor/lookup?patientId=PATIENT-000002");
    assert.equal(url.includes("Penicillin"), false);
    assert.equal(exactAllergyAlert([{ substance: "Penicillin" }], "penicillin").length, 1);
    assert.equal(exactAllergyAlert([{ substance: "Penicillin" }], "Amoxicillin").length, 0);
  });

  it("filters history without adding entries", () => {
    const items = [
      { at: "2026-01-01", category: "visit", title: "Review", clinician: "Dr Meera" },
      { at: "2026-02-01", category: "laboratory", title: "Hemoglobin", clinician: "Lab" },
    ];
    assert.equal(filterTimeline(items, { category: "visit", from: "2026-01-01", to: "2026-01-31" }).length, 1);
    assert.equal(filterTimeline(items, { query: "missing" }).length, 0);
  });
});