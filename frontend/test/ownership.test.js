import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { claimCommitmentForRecoveryCode, createRecoveryCode, sealedClaimForRecoveryCode } from "../src/lib/ownership.js";
import { registrationBody, validateOwnership } from "../src/services/patientService.js";

const require = createRequire(import.meta.url);
const { AbiCoder, keccak256, toUtf8Bytes } = require("../../backend/node_modules/ethers");

describe("patient ownership", () => {
  it("matches the contract claim commitment and omits the recovery secret", () => {
    const recoveryCode = createRecoveryCode();
    const secret = recoveryCode;
    const domain = keccak256(toUtf8Bytes("MedChain.claim.v1"));
    const encoded = AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [secret, domain]);
    const expected = keccak256(encoded);
    const commitment = claimCommitmentForRecoveryCode(recoveryCode);
    assert.equal(commitment, expected);
    const body = registrationBody(
      { fullName: "Synthetic Patient", dateOfBirth: "1990-01-01", secret: recoveryCode, recoveryCode },
      "",
      { claimCommitment: commitment }
    );
    assert.equal(body.claimCommitment, commitment);
    assert.equal(Object.hasOwn(body, "secret"), false);
    assert.equal(Object.hasOwn(body, "recoveryCode"), false);
    const wallet = validateOwnership({ mode: "wallet", controller: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
    assert.equal(wallet.ownership.controller, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    const unsaved = validateOwnership({ mode: "claim", claimCommitment: commitment, recoverySaved: false });
    assert.equal(unsaved.ownership, null);
    const walletAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const patientRef = `0x${"ab".repeat(32)}`;
    const sealedEncoded = AbiCoder.defaultAbiCoder().encode(
      ["address", "bytes32", "bytes32", "bytes32"],
      [walletAddress, recoveryCode, patientRef, domain],
    );
    assert.equal(sealedClaimForRecoveryCode(recoveryCode, walletAddress, patientRef), keccak256(sealedEncoded));
  });
});
