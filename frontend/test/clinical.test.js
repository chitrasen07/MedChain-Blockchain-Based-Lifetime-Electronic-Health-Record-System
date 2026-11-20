import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { claimBroadcastAllowed, claimCalldata, sendPatientClaim } from "../src/lib/claimChain.js";
import { clinicalRequestBody } from "../src/services/clinicalService.js";

const require = createRequire(import.meta.url);
const { Interface } = require("../../backend/node_modules/ethers");

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
});
