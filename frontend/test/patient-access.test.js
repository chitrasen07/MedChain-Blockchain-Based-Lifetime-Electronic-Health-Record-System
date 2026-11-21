import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clinicianLabel, shortWallet } from "../src/services/patientPortal.js";

describe("patient access labels", () => {
  it("shows a doctor by name, role, and shortened wallet", () => {
    const wallet = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const label = clinicianLabel({ name: "Asha Verma", role: "Doctor", walletAddress: wallet });
    assert.equal(shortWallet(wallet), "0x7099…79C8");
    assert.equal(label, "Asha Verma · Doctor · 0x7099…79C8");
    assert.equal(label.includes("C51812dc3A010C7d01b50e0d17dc"), false);
  });
});
