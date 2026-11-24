import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shortWallet } from "../src/services/patientPortal.js";
import { staffWalletState } from "../src/lib/staffWallet.js";

const address = "0x1111111111111111111111111111111111111111";

describe("staff wallet display", () => {
  it("keeps wallet verification separate from role and credential status", () => {
    assert.equal(staffWalletState({ role: "receptionist", status: "active" }).label, "Not required");
    assert.equal(staffWalletState({ role: "reviewer", status: "pending" }).label, "Not required");
    assert.equal(staffWalletState({ role: "doctor", status: "pending" }).label, "Verification pending");
    assert.equal(staffWalletState({ role: "hospital_staff", status: "active" }).label, "No wallet linked");
    assert.equal(staffWalletState({ role: "doctor", status: "active", walletAddress: address, authorizationStatus: "pending", profileStatus: "pending" }).label, "Wallet verified");
  });

  it("keeps the complete address for copying and a short label for the table", () => {
    const state = staffWalletState({ role: "doctor", status: "active", walletAddress: address });
    const label = shortWallet(state.address);
    assert.equal(state.address, address);
    assert.equal(label, "0x1111…1111");
    assert.equal(label.includes(address), false);
    assert.equal(staffWalletState({ role: "doctor", status: "active", walletAddress: "0x123" }).address, "");
  });
});
