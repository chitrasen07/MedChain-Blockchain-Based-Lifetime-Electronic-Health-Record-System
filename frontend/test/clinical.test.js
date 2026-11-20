import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { claimBroadcastAllowed, claimCalldata, sendPatientClaim } from "../src/lib/claimChain.js";
import { anchorCalldata, emergencyRequestCalldata, grantCalldata, reasonHash, revokeCalldata, sendPreparedTransaction } from "../src/lib/consentChain.js";
import { clinicalRequestBody } from "../src/services/clinicalService.js";

const require = createRequire(import.meta.url);
const { Interface, keccak256, toUtf8Bytes } = require("../../backend/node_modules/ethers");

describe("clinical records and claims", () => {
  it("sends clinical fields to the hospital service and does not build an anchor request", () => {
    const body = clinicalRequestBody({
      category: "prescription",
      recordedOn: "2026-04-01",
      fields: { medication: "Example", dose: "1", directions: "" },
      recoveryCode: "0x" + "11".repeat(32),
    });
    assert.deepEqual(body, {
      category: "prescription",
      recordedOn: "2026-04-01",
      fields: { medication: "Example", dose: "1" },
    });
    assert.equal(Object.hasOwn(body, "recoveryCode"), false);
  });

  it("prepares claim calldata locally and refuses a public broadcast", async () => {
    const patientRef = `0x${"ab".repeat(32)}`;
    const value = `0x${"cd".repeat(32)}`;
    const iface = new Interface([
      "function announceControllerClaim(bytes32 patientRef, bytes32 sealedClaim)",
      "function revealControllerClaim(bytes32 patientRef, bytes32 claimSecret)",
    ]);
    assert.equal(claimCalldata("announce", patientRef, value), iface.encodeFunctionData("announceControllerClaim", [patientRef, value]));
    assert.equal(claimCalldata("reveal", patientRef, value), iface.encodeFunctionData("revealControllerClaim", [patientRef, value]));
    assert.equal(claimBroadcastAllowed(11155111), false);
    assert.equal(claimBroadcastAllowed(31337), true);
    let requested = false;
    await assert.rejects(
      () => sendPatientClaim({
        kind: "reveal",
        patientRef,
        value,
        registryAddress: "0xDe1501AF8BACc3c1040788AFb8d2f784Ab8e2806",
        chainId: 11155111,
        ethereum: { request() { requested = true; } },
      }),
      /not sent without approval/,
    );
    assert.equal(requested, false);
  });

  it("prepares consent and emergency calldata without the clinical reason", async () => {
    const patientRef = `0x${"ab".repeat(32)}`;
    const wallet = "0x1111111111111111111111111111111111111111";
    const hash = `0x${"cd".repeat(32)}`;
    const reason = "Unconscious patient needs the allergy list";
    const access = new Interface([
      "function grantAccess(bytes32 patientRef, address authorizedAddress, uint256 expiresAt)",
      "function revokeAccess(bytes32 patientRef, address authorizedAddress)",
    ]);
    const emergency = new Interface([
      "function requestEmergencyAccess(bytes32 patientRef, bytes32 reasonHash, uint256 duration)",
    ]);
    const records = new Interface([
      "function createRecord(bytes32 recordRef, bytes32 patientRef, bytes32 recordHash, uint256 recordDate)",
    ]);
    assert.equal(grantCalldata(patientRef, wallet, 0), access.encodeFunctionData("grantAccess", [patientRef, wallet, 0]));
    assert.equal(revokeCalldata(patientRef, wallet), access.encodeFunctionData("revokeAccess", [patientRef, wallet]));
    assert.equal(emergencyRequestCalldata(patientRef, reason, 3600), emergency.encodeFunctionData("requestEmergencyAccess", [patientRef, reasonHash(reason), 3600]));
    assert.equal(reasonHash(reason), keccak256(toUtf8Bytes(reason)));
    assert.equal(emergencyRequestCalldata(patientRef, reason, 3600).toLowerCase().includes("unconscious"), false);
    assert.equal(anchorCalldata({ versionIndex: 0, recordRef: patientRef, patientRef, contentHash: hash }), records.encodeFunctionData("createRecord", [patientRef, patientRef, hash, 0]));
    let requested = false;
    await assert.rejects(
      () => sendPreparedTransaction({
        chainId: 11155111,
        contractAddress: wallet,
        data: grantCalldata(patientRef, wallet, 0),
        ethereum: { request() { requested = true; } },
      }),
      /not sent without approval/,
    );
    assert.equal(requested, false);
  });
});
