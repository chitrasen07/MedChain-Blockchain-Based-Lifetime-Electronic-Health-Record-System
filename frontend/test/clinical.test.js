import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { claimBroadcastAllowed, claimCalldata, loadClaimProgress, remainingClaimSeconds, saveClaimProgress, sendPatientClaim } from "../src/lib/claimChain.js";
import { SEPOLIA_MEDICAL_RECORDS, SEPOLIA_RECORD_ACCESS, anchorCalldata, emergencyRequestCalldata, grantCalldata, reasonHash, revokeCalldata, sendPreparedTransaction, transactionTarget } from "../src/lib/consentChain.js";
import { assignRoleCalldata, revokeRoleCalldata, sendRoleAssignment } from "../src/lib/roleChain.js";
import { clinicalRequestBody } from "../src/services/clinicalService.js";

const require = createRequire(import.meta.url);
const { Interface, id, keccak256, toUtf8Bytes } = require("../../backend/node_modules/ethers");

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

  it("prepares claim calldata and sends a Sepolia claim only after an explicit request", async () => {
    const patientRef = `0x${"ab".repeat(32)}`;
    const value = `0x${"cd".repeat(32)}`;
    const iface = new Interface([
      "function announceControllerClaim(bytes32 patientRef, bytes32 sealedClaim)",
      "function revealControllerClaim(bytes32 patientRef, bytes32 claimSecret)",
    ]);
    assert.equal(claimCalldata("announce", patientRef, value), iface.encodeFunctionData("announceControllerClaim", [patientRef, value]));
    assert.equal(claimCalldata("reveal", patientRef, value), iface.encodeFunctionData("revealControllerClaim", [patientRef, value]));
    assert.equal(claimBroadcastAllowed(11155111), true);
    assert.equal(claimBroadcastAllowed(31337), true);
    assert.equal(claimBroadcastAllowed(1), false);
    const calls = [];
    const ethereum = {
      async request({ method, params }) {
        calls.push({ method, params });
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "eth_requestAccounts") return ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"];
        if (method === "eth_sendTransaction") return `0x${"12".repeat(32)}`;
        throw new Error(method);
      },
    };
    const hash = await sendPatientClaim({
      kind: "announce",
      patientRef,
      value,
      chainId: 11155111,
      ethereum,
    });
    assert.equal(hash, `0x${"12".repeat(32)}`);
    assert.equal(calls.at(-1).method, "eth_sendTransaction");
    assert.equal(calls.at(-1).params[0].to, "0xDe1501AF8BACc3c1040788AFb8d2f784Ab8e2806");
    let blocked = false;
    await assert.rejects(
      () => sendPatientClaim({
        kind: "reveal",
        patientRef,
        value,
        chainId: 1,
        ethereum: { request() { blocked = true; } },
      }),
      /Sepolia/,
    );
    assert.equal(blocked, false);
    const store = new Map();
    globalThis.sessionStorage = {
      setItem(key, stored) { store.set(key, stored); },
      getItem(key) { return store.get(key) ?? null; },
    };
    saveClaimProgress({
      patientId: "PATIENT-000001",
      walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      announcedAt: 10,
      delaySeconds: 3600,
      recoveryCode: `0x${"aa".repeat(32)}`,
    });
    const saved = [...store.values()].join("");
    assert.equal(saved.includes("aa".repeat(32)), false);
    assert.equal(loadClaimProgress().announcedAt, 10);
    assert.equal(remainingClaimSeconds(10, 3600, 10_000), 3600);
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
      /approved consent or record/,
    );
    assert.equal(requested, false);
    let emergencyRequested = false;
    await assert.rejects(
      () => sendPreparedTransaction({
        chainId: 11155111,
        contractAddress: "0x7c662d0649eDa6406Decd37020a2aD3ea811Fbd6",
        data: emergencyRequestCalldata(patientRef, reason, 3600),
        ethereum: { request() { emergencyRequested = true; } },
      }),
      /approved consent or record/,
    );
    assert.equal(emergencyRequested, false);
    assert.equal(transactionTarget("anchor", 11155111), SEPOLIA_MEDICAL_RECORDS);
    assert.equal(transactionTarget("consent", 11155111), SEPOLIA_RECORD_ACCESS);
    assert.equal(transactionTarget("emergency", 11155111, "0x7c662d0649eDa6406Decd37020a2aD3ea811Fbd6"), "");
    const calls = [];
    const ethereum = {
      async request({ method, params }) {
        calls.push({ method, params });
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "eth_requestAccounts") return ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"];
        if (method === "eth_sendTransaction") return `0x${"34".repeat(32)}`;
        throw new Error(method);
      },
    };
    const sent = await sendPreparedTransaction({
      chainId: 11155111,
      contractAddress: SEPOLIA_RECORD_ACCESS,
      data: grantCalldata(patientRef, wallet, 0),
      ethereum,
    });
    assert.equal(sent, `0x${"34".repeat(32)}`);
    assert.equal(calls.at(-1).params[0].to, SEPOLIA_RECORD_ACCESS);
    const doctor = "0xf7d8e63eb6d81c4faded4fdda7edb10d28b54bb0";
    const roles = new Interface([
      "function assignRole(bytes32 role, address account)",
      "function revokeRole(bytes32 role, address account)",
    ]);
    assert.equal(assignRoleCalldata("DOCTOR", doctor), roles.encodeFunctionData("assignRole", [id("DOCTOR"), doctor]));
    assert.equal(assignRoleCalldata("SUPER_ADMIN", doctor), "");
    assert.equal(revokeRoleCalldata("DOCTOR", doctor), roles.encodeFunctionData("revokeRole", [id("DOCTOR"), doctor]));
    assert.equal(revokeRoleCalldata("HOSPITAL_ADMIN", doctor), "");
    const roleCalls = [];
    const roleEthereum = {
      async request({ method, params }) {
        roleCalls.push({ method, params });
        if (method === "eth_chainId") return "0xaa36a7";
        if (method === "eth_requestAccounts") return ["0xD272a1e1027CDCDeA3ebbB8A9D01977e2030547F"];
        if (method === "eth_sendTransaction") return `0x${"56".repeat(32)}`;
        throw new Error(method);
      },
    };
    await sendRoleAssignment({ chainId: 11155111, roleName: "DOCTOR", account: doctor, ethereum: roleEthereum });
    assert.equal(roleCalls.at(-1).params[0].to, "0xDE4331A5D901B1aBBbE98B51F075e5D0A5894B78");
    assert.equal(roleCalls.at(-1).params[0].data, assignRoleCalldata("DOCTOR", doctor));
  });
});
